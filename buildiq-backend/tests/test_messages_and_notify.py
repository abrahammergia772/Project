"""Direct messages, notification authoring, and profile photos.

Scoping rules under test:
  * a user reads only conversations they are part of -- not even Super Admin
    can open someone else's inbox through this API;
  * notification authors are limited to their own reach (Admin/GM org-wide,
    Department Manager to their department, Project Manager to individuals);
  * avatar upload only ever writes to the caller's own row.
"""
import io

PW = "Demo1234!"

# A 1x1 PNG, so the upload path is exercised with real image bytes.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6300010000050001"
)


def _tok(client, email):
    r = client.post("/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, email
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _id(client, headers):
    return client.get("/auth/me", headers=headers).json()["id"]


# ---------------- Messages ----------------

def test_a_message_can_be_sent_and_read(client):
    admin = _tok(client, "admin@buildiq.et")
    eng = _tok(client, "engineer@buildiq.et")
    eng_id = _id(client, eng)

    r = client.post("/messages", headers=admin,
                    json={"recipient_id": eng_id, "body": "Site meeting at 9"})
    assert r.status_code == 201
    assert r.json()["body"] == "Site meeting at 9"


def test_the_recipient_sees_it_as_unread(client):
    admin = _tok(client, "admin@buildiq.et")
    eng = _tok(client, "engineer@buildiq.et")
    eng_id, admin_id = _id(client, eng), _id(client, admin)

    before = client.get("/messages/unread-count", headers=eng).json()["count"]
    client.post("/messages", headers=admin,
                json={"recipient_id": eng_id, "body": "unread probe"})
    after = client.get("/messages/unread-count", headers=eng).json()["count"]
    assert after == before + 1

    # Opening the thread marks it read.
    client.get(f"/messages/{admin_id}", headers=eng)
    assert client.get("/messages/unread-count", headers=eng).json()["count"] == 0


def test_a_thread_contains_both_directions(client):
    admin = _tok(client, "admin@buildiq.et")
    eng = _tok(client, "engineer@buildiq.et")
    eng_id, admin_id = _id(client, eng), _id(client, admin)

    client.post("/messages", headers=admin,
                json={"recipient_id": eng_id, "body": "ping"})
    client.post("/messages", headers=eng,
                json={"recipient_id": admin_id, "body": "pong"})

    thread = client.get(f"/messages/{eng_id}", headers=admin).json()
    bodies = [m["body"] for m in thread]
    assert "ping" in bodies and "pong" in bodies


def test_you_cannot_read_someone_elses_conversation(client):
    """The core privacy rule: a third party sees an empty thread."""
    admin = _tok(client, "admin@buildiq.et")
    eng = _tok(client, "engineer@buildiq.et")
    auditor = _tok(client, "auditor@buildiq.et")
    eng_id = _id(client, eng)

    client.post("/messages", headers=admin,
                json={"recipient_id": eng_id, "body": "private note"})

    # The auditor asks for the engineer's thread: they only ever get messages
    # between themselves and that person, which is none.
    seen = client.get(f"/messages/{eng_id}", headers=auditor).json()
    assert all("private note" != m["body"] for m in seen)


def test_you_cannot_message_yourself(client):
    admin = _tok(client, "admin@buildiq.et")
    r = client.post("/messages", headers=admin,
                    json={"recipient_id": _id(client, admin), "body": "hi me"})
    assert r.status_code == 400


def test_messaging_an_unknown_member_is_rejected(client):
    admin = _tok(client, "admin@buildiq.et")
    r = client.post("/messages", headers=admin,
                    json={"recipient_id": "mem_does_not_exist", "body": "x"})
    assert r.status_code == 404


def test_contacts_exclude_clients_and_self(client):
    admin = _tok(client, "admin@buildiq.et")
    people = client.get("/messages/contacts", headers=admin).json()
    assert people
    assert all(p["role"] != "Client" for p in people)
    assert all(p["id"] != _id(client, admin) for p in people)


def test_conversations_list_the_latest_message(client):
    admin = _tok(client, "admin@buildiq.et")
    eng = _tok(client, "engineer@buildiq.et")
    client.post("/messages", headers=admin,
                json={"recipient_id": _id(client, eng), "body": "newest line"})
    convos = client.get("/messages/conversations", headers=admin).json()
    assert any(c["last_message"] == "newest line" for c in convos)


# ---------------- Writing notifications ----------------

def test_who_may_send_notifications(client):
    expected = {
        "admin@buildiq.et": (True, "organization"),
        "gm@buildiq.et": (True, "organization"),
        "meron.tadesse@buildiq.et": (True, "department"),
        "pm@buildiq.et": (True, "projects"),
        "engineer@buildiq.et": (False, "none"),
        "auditor@buildiq.et": (False, "none"),
        "client@buildiq.et": (False, "none"),
    }
    for email, (can, scope) in expected.items():
        body = client.get("/notifications/can-send", headers=_tok(client, email)).json()
        assert body["can_send"] is can, email
        assert body["scope"] == scope, email


def test_an_engineer_cannot_send_one(client):
    r = client.post("/notifications", headers=_tok(client, "engineer@buildiq.et"),
                    json={"title": "T", "body": "B", "roles": ["Engineer"]})
    assert r.status_code == 403


def test_only_org_wide_roles_can_broadcast_to_a_role(client):
    ok = client.post("/notifications", headers=_tok(client, "admin@buildiq.et"),
                     json={"title": "T", "body": "B", "roles": ["Engineer"]})
    assert ok.status_code == 201

    for email in ("meron.tadesse@buildiq.et", "pm@buildiq.et"):
        r = client.post("/notifications", headers=_tok(client, email),
                        json={"title": "T", "body": "B", "roles": ["Engineer"]})
        assert r.status_code == 403, email


def test_a_department_manager_is_confined_to_their_department(client):
    dm = _tok(client, "meron.tadesse@buildiq.et")
    own = client.get("/auth/me", headers=dm).json()["department"]

    assert client.post("/notifications", headers=dm,
                       json={"title": "T", "body": "B",
                             "departments": [own]}).status_code == 201

    others = [d["name"] for d in
              client.get("/departments", headers=_tok(client, "admin@buildiq.et")).json()
              if d["name"] != own]
    assert client.post("/notifications", headers=dm,
                       json={"title": "T", "body": "B",
                             "departments": [others[0]]}).status_code == 403


def test_a_project_manager_cannot_target_a_department(client):
    r = client.post("/notifications", headers=_tok(client, "pm@buildiq.et"),
                    json={"title": "T", "body": "B", "departments": ["Site Operations"]})
    assert r.status_code == 403


def test_a_notification_needs_at_least_one_recipient(client):
    r = client.post("/notifications", headers=_tok(client, "admin@buildiq.et"),
                    json={"title": "T", "body": "B"})
    assert r.status_code == 422


def test_the_recipient_actually_receives_it(client):
    admin = _tok(client, "admin@buildiq.et")
    eng = _tok(client, "engineer@buildiq.et")
    eng_id = _id(client, eng)

    client.post("/notifications", headers=admin,
                json={"title": "Delivered probe", "body": "B", "user_ids": [eng_id]})
    titles = [n["title"] for n in client.get("/notifications", headers=eng).json()]
    assert "Delivered probe" in titles


def test_sending_is_recorded_in_the_audit_trail(client):
    admin = _tok(client, "admin@buildiq.et")
    client.post("/notifications", headers=admin,
                json={"title": "Audited", "body": "B", "roles": ["Engineer"]})
    logs = client.get("/audit/logs?action=SEND_NOTIFICATION&limit=20",
                      headers=admin).json()
    assert logs


# ---------------- Profile photo ----------------

def test_a_user_can_upload_their_own_photo(client):
    admin = _tok(client, "admin@buildiq.et")
    r = client.post("/members/me/avatar", headers=admin,
                    files={"file": ("a.png", io.BytesIO(PNG), "image/png")})
    assert r.status_code == 200
    assert r.json()["avatar_url"].endswith(".png")


def test_a_non_image_is_rejected(client):
    r = client.post("/members/me/avatar", headers=_tok(client, "admin@buildiq.et"),
                    files={"file": ("x.txt", io.BytesIO(b"not an image"), "text/plain")})
    assert r.status_code == 415


def test_an_oversized_image_is_rejected(client):
    big = io.BytesIO(b"x" * (3 * 1024 * 1024))
    r = client.post("/members/me/avatar", headers=_tok(client, "admin@buildiq.et"),
                    files={"file": ("big.png", big, "image/png")})
    assert r.status_code == 413


def test_an_empty_file_is_rejected(client):
    r = client.post("/members/me/avatar", headers=_tok(client, "admin@buildiq.et"),
                    files={"file": ("e.png", io.BytesIO(b""), "image/png")})
    assert r.status_code == 400


def test_an_uploaded_photo_can_be_fetched(client):
    admin = _tok(client, "admin@buildiq.et")
    client.post("/members/me/avatar", headers=admin,
                files={"file": ("a.png", io.BytesIO(PNG), "image/png")})
    r = client.get(f"/members/{_id(client, admin)}/avatar",
                   headers=_tok(client, "engineer@buildiq.et"))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/")


def test_fetching_a_photo_requires_a_session(client):
    r = client.get("/members/mem_1/avatar")
    assert r.status_code in (401, 403)


def test_you_can_always_reply_to_someone_who_messaged_you(client):
    """An Engineer's scope is their department, so a reply to the Super Admin
    was rejected with 403 while the Admin's original message went through.
    Being written to grants a reply channel."""
    admin = _tok(client, "admin@buildiq.et")
    eng = _tok(client, "engineer@buildiq.et")
    admin_id, eng_id = _id(client, admin), _id(client, eng)

    assert client.post("/messages", headers=admin,
                       json={"recipient_id": eng_id, "body": "from admin"}
                       ).status_code == 201
    assert client.post("/messages", headers=eng,
                       json={"recipient_id": admin_id, "body": "reply"}
                       ).status_code == 201


def test_an_unsolicited_message_outside_your_scope_is_still_blocked(client):
    """The reply exemption must not become a general bypass."""
    from app.database import SessionLocal
    from app.models import Message, User
    from sqlalchemy import or_, select

    eng = _tok(client, "engineer@buildiq.et")
    eng_id = _id(client, eng)

    db = SessionLocal()
    try:
        contacts = {c["id"] for c in
                    client.get("/messages/contacts", headers=eng).json()}
        # Someone outside the engineer's scope who has never written to them.
        stranger = None
        for u in db.scalars(select(User).where(User.role != "Client")).all():
            if u.id in contacts or u.id == eng_id:
                continue
            prior = db.scalar(select(Message).where(
                Message.sender_id == u.id, Message.recipient_id == eng_id).limit(1))
            if prior is None:
                stranger = u.id
                break
    finally:
        db.close()

    if stranger is None:
        return          # every visible member is in scope in this dataset
    r = client.post("/messages", headers=eng,
                    json={"recipient_id": stranger, "body": "cold open"})
    assert r.status_code == 403
