-- =============================================================================
-- Migration: keep no IP addresses in the auth schema
--
-- School WiFi, VPN and lab logins can map an IP and a timestamp back to a named
-- student, so no raw IP may be kept anywhere. The app itself never stores one,
-- but GoTrue does, for every request the browser still sends it directly (token
-- refresh, sign-out) and for the ones the `account` function proxies:
--
--   * `auth.audit_log_entries.ip_address` — VARCHAR NOT NULL DEFAULT '', so it
--     is blanked rather than nulled;
--   * `auth.sessions.ip` — INET, nullable; only present on GoTrue versions that
--     record session metadata, hence the guard below.
--
-- BEFORE INSERT / UPDATE triggers blank the value before it is ever written,
-- and the UPDATEs scrub anything recorded before this migration ran.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.scrub_audit_log_ip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.ip_address := '';
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scrub_audit_log_ip ON auth.audit_log_entries;

CREATE TRIGGER scrub_audit_log_ip
    BEFORE INSERT OR UPDATE ON auth.audit_log_entries
    FOR EACH ROW EXECUTE FUNCTION public.scrub_audit_log_ip();

UPDATE auth.audit_log_entries SET ip_address = '' WHERE ip_address <> '';


CREATE OR REPLACE FUNCTION public.scrub_session_ip()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.ip := NULL;
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'sessions' AND column_name = 'ip'
    ) THEN
        DROP TRIGGER IF EXISTS scrub_session_ip ON auth.sessions;
        CREATE TRIGGER scrub_session_ip
            BEFORE INSERT OR UPDATE ON auth.sessions
            FOR EACH ROW EXECUTE FUNCTION public.scrub_session_ip();
        UPDATE auth.sessions SET ip = NULL WHERE ip IS NOT NULL;
    END IF;
END;
$$;
