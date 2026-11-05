import { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { Avatar, Stack, Typography } from "@mui/joy";
import { useOutletContext } from "react-router-dom";

/**
 * The identity half of the profile page.
 *
 * There is deliberately nothing to edit here and nothing personal to show. An
 * account is a username, a password and a recovery code; it carries no name, no
 * email address and no student number, so the only thing this can display is
 * the username the student chose when they registered.
 *
 * It used to show `session.user.email` and a student number, which is exactly
 * what tied an account to a named student. The email on an account is now a
 * random placeholder (see supabase/functions/account/placeholder.ts) and must
 * never be rendered — UserInfo.test.tsx guards that.
 */
export default function UserInfo() {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");

  const { session } = useOutletContext<{ session: Session | null }>();
  // Depend on the id, not the Session object: a context that hands back a new
  // object each render would otherwise re-read the profile every render.
  const userId = session?.user?.id;

  useEffect(() => {
    let ignore = false;

    (async function getProfile() {
      if (!userId) return;

      const { data, error } = await supabase
        .from('profiles')
        .select(`username`)
        .eq('profile_id', userId)
        .single();

      if (ignore) return;
      if (error) {
        setError(error.message);
        console.warn(error);
      } else if (data) {
        setUsername(data.username ?? "");
      }
    })();

    return () => {
      ignore = true;
    }
  }, [userId])

  return (
    <Stack alignItems="center" className="account" gap={1}>
      <Avatar color="primary" size="lg">{(username || "?").charAt(0)}</Avatar>
      <Typography level="h2">{username || "Unnamed User"}</Typography>
      <Typography level="body-sm" sx={{ maxWidth: "22em", textAlign: "center" }}>
        This account has no name, email address or student number attached to it.
        Keep it that way: never put your name or student number in your code, in
        your questions for the AI tutor, or in your reflections.
      </Typography>
      {!!error && <Typography color="danger">{error}</Typography>}
    </Stack>
  )
}
