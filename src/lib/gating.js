// Should other people's picks be visible right now?
// Hidden pre-deadline to prevent copying. Admins always see everything.
export function picksRevealed(tournament, session) {
  if (!tournament) return true;
  if (session?.isAdmin) return true;
  if (!tournament.deadline) return true;
  return new Date(tournament.deadline).getTime() < Date.now();
}

export function deadlineLabel(tournament) {
  if (!tournament?.deadline) return '';
  return new Date(tournament.deadline).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}
