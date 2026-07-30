"""
BuildIQ — routers/documents.py
Real file upload/download backed by Supabase Storage (local disk fallback).
Bytes are stored and returned verbatim, so a download is byte-identical to
what was uploaded.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import format_bytes, icon_for_file, new_id, record_audit, utcnow
from ..models import Document, User
from ..schemas import DocumentOut, OkResponse
from ..security import AUDITOR, CLIENT, DEPARTMENT_MANAGER, ORG_WIDE, get_current_user
from ..services import storage

router = APIRouter(prefix="/documents", tags=["documents"])


def _visible(db: Session, user: User) -> list[Document]:
    docs = list(db.scalars(select(Document).order_by(Document.uploaded_at.desc())).all())
    if user.role in ORG_WIDE or user.role == AUDITOR:
        return docs
    if user.role == CLIENT:
        return [d for d in docs if d.uploaded_by_id == user.id]
    return [d for d in docs
            if not d.department or d.department == user.department or d.uploaded_by_id == user.id]


def _can_delete(user: User, doc: Document) -> bool:
    if user.role in ORG_WIDE:
        return True
    if user.role == DEPARTMENT_MANAGER:
        return doc.department == user.department or doc.uploaded_by_id == user.id
    return doc.uploaded_by_id == user.id


@router.get("", response_model=list[DocumentOut])
def list_documents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _visible(db, user)


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(file: UploadFile = File(...),
                          user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == AUDITOR:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Auditors have read-only access")
    if not file.filename:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A filename is required")

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    chunks, size = [], 0
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                f"File exceeds the {settings.MAX_UPLOAD_MB} MB limit")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The uploaded file is empty")

    doc_id = new_id("doc")
    safe_name = os.path.basename(file.filename)
    # Store under a generated key to avoid collisions and path traversal.
    key = f"{doc_id}{Path(safe_name).suffix[:16]}"
    content_type = file.content_type or "application/octet-stream"

    try:
        storage_key, backend = storage.upload(key, data, content_type)
    except Exception:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not store the uploaded file")

    icon, color = icon_for_file(safe_name)
    doc = Document(
        id=doc_id, name=safe_name, storage_key=storage_key, storage_backend=backend,
        content_type=content_type, size_bytes=size, size_label=format_bytes(size),
        icon=icon, color=color, uploaded_by=user.full_name, uploaded_by_id=user.id,
        department=user.department, uploaded_at=utcnow(),
    )
    db.add(doc)
    db.commit()

    record_audit(db, user, "FILE_UPLOAD", f"documents/{doc.name}")
    return doc


@router.get("/{document_id}/download")
def download_document(document_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if doc.id not in {d.id for d in _visible(db, user)}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to that document")

    data = storage.download(doc.storage_key, doc.storage_backend)
    if data is None:
        raise HTTPException(status.HTTP_410_GONE, "The stored file is no longer available")

    record_audit(db, user, "EXPORT_DATA", f"documents/{doc.name}")
    return Response(
        content=data,
        media_type=doc.content_type,
        headers={"Content-Disposition": f'attachment; filename="{doc.name}"'},
    )


@router.delete("/{document_id}", response_model=OkResponse)
def delete_document(document_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if not _can_delete(user, doc):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot delete this document")

    storage.delete(doc.storage_key, doc.storage_backend)
    name = doc.name
    db.delete(doc)
    db.commit()

    record_audit(db, user, "DELETE_DOCUMENT", f"documents/{name}")
    return OkResponse()
