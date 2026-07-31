"""SUPABASE_URL normalisation.

A live deploy logged:

    GET https://<ref>.supabase.co/rest/v1/storage/v1/bucket  ->  404
    WARNING Could not verify Supabase bucket: 'error'

SUPABASE_URL had been set to the REST endpoint (".../rest/v1"). The Supabase
client appends its own service path, producing a doubled URL. The dashboard
shows several URLs, so this is easy to get wrong -- normalise rather than
punish.
"""
from app.config import Settings

REF = "https://ocfyddxklqephrvxqgfb.supabase.co"


def test_bare_project_url_is_left_alone():
    s = Settings(SUPABASE_URL=REF)
    assert s.supabase_base_url == REF
    assert s.supabase_url_had_service_path is False


def test_trailing_slash_is_trimmed():
    assert Settings(SUPABASE_URL=REF + "/").supabase_base_url == REF


def test_rest_endpoint_is_normalised():
    """The exact misconfiguration seen in production."""
    s = Settings(SUPABASE_URL=REF + "/rest/v1")
    assert s.supabase_base_url == REF
    assert s.supabase_url_had_service_path is True


def test_every_service_path_is_stripped():
    for suffix in ("/rest/v1", "/storage/v1", "/auth/v1", "/graphql/v1", "/realtime/v1"):
        s = Settings(SUPABASE_URL=REF + suffix)
        assert s.supabase_base_url == REF, suffix
        assert s.supabase_url_had_service_path is True, suffix


def test_surrounding_whitespace_is_ignored():
    s = Settings(SUPABASE_URL=f"  {REF}/rest/v1  ")
    assert s.supabase_base_url == REF


def test_empty_url_stays_empty_and_does_not_warn():
    s = Settings(SUPABASE_URL="")
    assert s.supabase_base_url == ""
    assert s.supabase_url_had_service_path is False
    assert s.storage_ready is False


def test_storage_ready_uses_the_normalised_url():
    s = Settings(SUPABASE_URL=REF + "/rest/v1", SUPABASE_SERVICE_KEY="k")
    assert s.storage_ready is True


def test_storage_client_is_built_from_the_normalised_url():
    """The client must never receive the raw value."""
    import inspect
    from app.services import storage
    src = inspect.getsource(storage)
    assert "settings.supabase_base_url" in src
    assert "create_client(settings.SUPABASE_URL" not in src
