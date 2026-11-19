const genericToken = /^QR_[A-Za-z0-9_-]{24,160}$/;
const roomToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function qrSignInPath(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  const scan = params.get("token");
  const room = params.get("roomToken");
  if (pathname === "/scan-qr" && scan && genericToken.test(scan)) {
    return `/login?scan=${encodeURIComponent(scan)}`;
  }
  if (pathname === "/report-issue" && room && roomToken.test(room)) {
    return `/login?room=${encodeURIComponent(room)}`;
  }
  return "/login";
}

export function qrRouteAfterSignIn(search: string) {
  const params = new URLSearchParams(search);
  const scan = params.get("scan");
  const room = params.get("room");
  if (scan && genericToken.test(scan)) return `/scan-qr?token=${encodeURIComponent(scan)}`;
  if (room && roomToken.test(room)) return `/report-issue?roomToken=${encodeURIComponent(room)}`;
  return "/";
}
