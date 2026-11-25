// Turns the backend's load error (raw ODBC text) into a plain-language reason for the screen.
// kind: 'offline' (network / timeout), 'login' (user or password refused), 'slow' (answer took too long), 'error' (anything else).

const NETWORK = /SQLSTATE\[(08001|08S01|HYT00)\]|TCP Provider|Named Pipes|timed out|timeout expired|not reachable|could not open a connection/i;
const LOGIN = /SQLSTATE\[28000\]|Login failed/i;

export function describeLoadError(message, lineName) {
  const msg = String(message || '');
  const m = /\((Line \d+)\)/.exec(msg);
  const name = lineName || (m ? m[1] : 'This line');
  const retry = /retrying in (\d+) s/.exec(msg);
  const retryIn = retry ? Number(retry[1]) : null;
  if (LOGIN.test(msg)) {
    return { kind: 'login', title: `${name} server refused the login`, retryIn: null, detail: msg,
      hint: 'The user or password of this line has changed. The administrator must update the line settings of the dashboard (backend/config/db.php).' };
  }
  if (NETWORK.test(msg)) {
    return { kind: 'offline', title: `${name} server is not reachable`, retryIn, detail: msg,
      hint: 'The database server of this line does not answer on the network. Check that the line PC is switched on and connected. The other lines are not affected.' };
  }
  if (/took longer than/i.test(msg)) {
    return { kind: 'slow', title: `${name} answered too slowly`, retryIn: null, detail: msg,
      hint: 'Choose a shorter period, or try again in a moment.' };
  }
  return { kind: 'error', title: `${name} data could not be loaded`, retryIn: null, detail: msg, hint: 'Try again. If it keeps failing, see the technical details.' };
}
