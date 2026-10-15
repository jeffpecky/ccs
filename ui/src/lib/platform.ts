export type ClientPlatformKey = 'darwin' | 'linux' | 'win32';

type NavigatorWithUserAgentData = Pick<Navigator, 'platform' | 'userAgent'> & {
  userAgentData?: {
    platform?: string | null;
  };
};

function normalizeClientPlatform(value: string): ClientPlatformKey {
  const platform = value.toLowerCase();
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('win')) return 'win32';
  return 'linux';
}

export function getClientPlatformKey(
  nav: NavigatorWithUserAgentData = navigator as NavigatorWithUserAgentData
): ClientPlatformKey {
  const userAgentDataPlatform =
    typeof nav.userAgentData?.platform === 'string' ? nav.userAgentData.platform : '';
  const fallbackPlatform =
    typeof nav.platform === 'string' && nav.platform.trim() ? nav.platform : nav.userAgent;

  return normalizeClientPlatform(userAgentDataPlatform || fallbackPlatform || '');
}
