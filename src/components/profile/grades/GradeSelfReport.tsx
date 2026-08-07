import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Stack,
  Typography,
} from '@mui/joy';
import { X } from '@phosphor-icons/react';
import Markdown from 'markdown-to-jsx';
import { GRADE_ITEM_LABELS, GRADE_ITEMS, GradeItem } from '../../../types';
import useGradeReport from '../../../hooks/useGradeReport';

type Draft = Partial<Record<GradeItem, string>>;
type ServerGrades = Partial<Record<GradeItem, number>>;

function draftFromServer(grades: ServerGrades): Draft {
  const draft: Draft = {};
  for (const item of GRADE_ITEMS) {
    const value = grades[item];
    draft[item] = value === undefined ? '' : String(value);
  }
  return draft;
}

/** Empty means "no answer"; anything else must parse to a percentage. */
function fieldError(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return 'Enter a number';
  if (n < 0 || n > 100) return 'Must be between 0 and 100';
  return null;
}

/**
 * Merge a new server view into the current draft without discarding edits.
 *
 * Naively replacing the whole draft on every reply loses anything typed while a
 * request was in flight — and, worse, the "try again" path after a failure
 * silently threw away everything the student had entered. So a field is only
 * taken from the server when the student has not moved it away from the value
 * the server last reported.
 */
export function mergeDraft(draft: Draft, previous: ServerGrades, next: ServerGrades): Draft {
  const merged: Draft = {};
  for (const item of GRADE_ITEMS) {
    const typed = draft[item] ?? '';
    const wasShowing = previous[item] === undefined ? '' : String(previous[item]);
    const nowIs = next[item] === undefined ? '' : String(next[item]);
    merged[item] = typed === wasShowing ? nowIs : typed;
  }
  return merged;
}

/**
 * Voluntary self-reporting of course grades for the COMP204 study.
 *
 * The component never learns the student's research pseudonym: the Edge Function
 * derives it server-side from the caller's JWT and uses it to read their own
 * answers back. See supabase/functions/submit-grades/pseudonym.ts.
 *
 * Feature gating is delegated to the server rather than read from the `activated`
 * table here. The function already fails closed with `flag_off`, so trusting that
 * answer keeps one source of truth and saves a round trip.
 */
export default function GradeSelfReport() {
  const { state, busy, grantConsent, withdraw, submit, retry, dismissError } =
    useGradeReport(true);

  const [draft, setDraft] = useState<Draft>({});
  const [consentOpen, setConsentOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const serverGrades = state.data?.grades;
  const lastServerGrades = useRef<ServerGrades | null>(null);

  useEffect(() => {
    if (!serverGrades) return;
    const previous = lastServerGrades.current;
    setDraft((current) =>
      previous === null
        ? draftFromServer(serverGrades)
        : mergeDraft(current, previous, serverGrades),
    );
    lastServerGrades.current = serverGrades;
  }, [serverGrades]);

  const errors = useMemo(() => {
    const out: Partial<Record<GradeItem, string>> = {};
    for (const item of GRADE_ITEMS) {
      const message = fieldError(draft[item] ?? '');
      if (message) out[item] = message;
    }
    return out;
  }, [draft]);

  const hasErrors = Object.keys(errors).length > 0;

  // Only send what actually changed, so the append-only table does not collect
  // rows that record nothing and "Save" is correctly inert when nothing moved.
  const changes = useMemo(() => {
    if (!serverGrades) return {};
    const out: Partial<Record<GradeItem, number | null>> = {};
    for (const item of GRADE_ITEMS) {
      const raw = (draft[item] ?? '').trim();
      const before = serverGrades[item];
      if (raw === '') {
        if (before !== undefined) out[item] = null; // explicit clear
      } else {
        const n = Number(raw);
        if (Number.isFinite(n) && n !== before) out[item] = n;
      }
    }
    return out;
  }, [draft, serverGrades]);

  const changeCount = Object.keys(changes).length;

  if (state.phase === 'loading') {
    return (
      <Stack alignItems="center" gap={1}>
        <Typography level="h2">Course Grades</Typography>
        <Typography level="body-sm">Loading...</Typography>
      </Stack>
    );
  }

  // Nothing ever loaded. Only here do flag_off and auth mean "render nothing":
  // the feature is dark, or this viewer is not signed in.
  if (state.phase === 'error' || !state.data) {
    const kind = state.error?.kind;
    if (kind === 'flag_off' || kind === 'auth') return null;

    return (
      <Stack alignItems="center" gap={1}>
        <Typography level="h2">Course Grades</Typography>
        <Alert color="danger" variant="soft">
          {state.error?.message ?? 'Could not load your grade reporting.'}
        </Alert>
        <Button size="sm" variant="outlined" onClick={retry} loading={busy}>
          Try again
        </Button>
      </Stack>
    );
  }

  const { consent } = state.data;

  // An error raised after we had data is shown alongside the form, never
  // instead of it — the student's typing has to survive a failed save.
  const errorBanner = state.error && (
    <Alert
      color="danger"
      variant="soft"
      size="sm"
      endDecorator={
        <IconButton variant="plain" color="danger" size="sm" onClick={dismissError}>
          <X />
        </IconButton>
      }
    >
      {state.error.message}
    </Alert>
  );

  // --- Not yet consented ---------------------------------------------------
  if (!consent.granted) {
    return (
      <Stack alignItems="center" gap={1.5} sx={{ maxWidth: 420 }}>
        <Typography level="h2">Course Grades</Typography>
        {errorBanner}
        <Typography level="body-sm" textAlign="center">
          You can help us understand whether this tutor actually helps, by
          sharing your exam and assignment scores. It is optional and does not
          affect your grade.
        </Typography>
        <Button onClick={() => setConsentOpen(true)}>Read more</Button>

        <Modal open={consentOpen} onClose={() => setConsentOpen(false)}>
          <ModalDialog sx={{ maxWidth: 620, maxHeight: '85vh' }} variant="outlined">
            <ModalClose />
            <Typography level="h3">Sharing your grades for research</Typography>
            <Box sx={{ overflowY: 'auto', pr: 1 }}>
              <Markdown>{consent.text}</Markdown>
            </Box>
            <Divider />
            <Stack direction="row" gap={1} justifyContent="flex-end">
              <Button variant="outlined" color="neutral" onClick={() => setConsentOpen(false)}>
                Not now
              </Button>
              <Button
                loading={busy}
                onClick={async () => {
                  const ok = await grantConsent(consent.version);
                  if (ok) setConsentOpen(false);
                }}
              >
                I agree
              </Button>
            </Stack>
          </ModalDialog>
        </Modal>
      </Stack>
    );
  }

  // --- Consented: the form -------------------------------------------------
  const saveLabel = changeCount > 0
    ? `Save ${changeCount} change${changeCount === 1 ? '' : 's'}`
    : 'Save';

  return (
    <Stack alignItems="center" gap={1.5} sx={{ width: '100%', maxWidth: 420 }}>
      <Typography level="h2">Course Grades</Typography>
      {errorBanner}
      <Typography level="body-xs" textAlign="center">
        Optional. Leave anything blank that you do not have yet, and come back
        after each exam. Clearing a box removes that score.
      </Typography>

      <Stack gap={1} sx={{ width: '100%' }}>
        {GRADE_ITEMS.map((item) => (
          <FormControl key={item} error={Boolean(errors[item])} size="sm">
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
              <FormLabel sx={{ mb: 0, minWidth: 120 }}>{GRADE_ITEM_LABELS[item]}</FormLabel>
              <Input
                size="sm"
                sx={{ width: 110 }}
                placeholder="—"
                endDecorator="%"
                slotProps={{ input: { type: 'number', min: 0, max: 100, step: 0.5 } }}
                value={draft[item] ?? ''}
                onChange={(e) => {
                  setSavedAt(null);
                  setDraft((d) => ({ ...d, [item]: e.target.value }));
                }}
              />
            </Stack>
            {errors[item] && <FormHelperText>{errors[item]}</FormHelperText>}
          </FormControl>
        ))}
      </Stack>

      <Stack direction="row" gap={1} alignItems="center">
        <Button
          size="sm"
          loading={busy}
          disabled={hasErrors || changeCount === 0}
          onClick={async () => {
            const ok = await submit(changes);
            if (ok) setSavedAt(Date.now());
          }}
        >
          {saveLabel}
        </Button>
        <Button
          size="sm"
          variant="plain"
          color="neutral"
          onClick={() => setWithdrawOpen(true)}
        >
          Withdraw
        </Button>
      </Stack>

      {/* Only after a save actually happened — an untouched form is not "Saved". */}
      {savedAt !== null && changeCount === 0 && !state.error && (
        <Typography level="body-xs" color="success">Saved. Thank you.</Typography>
      )}

      <Modal open={withdrawOpen} onClose={() => setWithdrawOpen(false)}>
        <ModalDialog variant="outlined" sx={{ maxWidth: 480 }}>
          <ModalClose />
          <Typography level="h4">Withdraw from the study?</Typography>
          <Typography level="body-sm">
            This deletes every score you have entered and stops your data being
            used. You can opt back in later, but the scores you entered will not
            come back. Nothing else about your account changes.
          </Typography>
          <Stack direction="row" gap={1} justifyContent="flex-end">
            <Button variant="outlined" color="neutral" onClick={() => setWithdrawOpen(false)}>
              Cancel
            </Button>
            <Button
              color="danger"
              loading={busy}
              onClick={async () => {
                const ok = await withdraw();
                if (ok) setWithdrawOpen(false);
              }}
            >
              Withdraw and delete
            </Button>
          </Stack>
        </ModalDialog>
      </Modal>
    </Stack>
  );
}
