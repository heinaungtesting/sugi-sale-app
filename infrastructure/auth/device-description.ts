export function describeDevice(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const os = ua.includes('iphone') ? 'iPhone'
    : ua.includes('ipad') ? 'iPad'
      : ua.includes('android') ? 'Android'
        : ua.includes('mac os') || ua.includes('macintosh') ? 'Mac'
          : ua.includes('windows') ? 'Windows'
            : ua.includes('linux') ? 'Linux'
              : 'Unknown device';
  const browser = ua.includes('edg/') ? 'Edge'
    : ua.includes('crios/') ? 'Chrome'
      : ua.includes('fxios/') ? 'Firefox'
        : ua.includes('chrome/') ? 'Chrome'
          : ua.includes('firefox/') ? 'Firefox'
            : ua.includes('safari/') ? 'Safari'
              : 'Browser';
  return `${os} · ${browser}`;
}
