import { useEffect, useState } from 'react';
import { Button, Input } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import {
  DEFAULT_STEM_SERVER_URL,
  STEM_QUALITIES,
  STEM_QUALITY_KEY,
  STEM_SERVER_URL_KEY,
  StemQuality,
} from '../../../stemServerUrl';
import { IpcCheckStemToolsResponse, StemServerHealth } from '../../../types';
import { assertNever } from '../../../shared/assertNever';
import { usePersisted } from '../../hooks/usePersisted';
import { useStemToolsContext } from '../../context/StemToolsContext';
import { SettingLabel } from '../SettingsButton/SettingLabel';
import { Tooltip } from '../Tooltip';

const DEFAULT_URL = DEFAULT_STEM_SERVER_URL;

/** What the status line says, and its hover text. */
function describeHealth(health: StemServerHealth | undefined): {
  label: string;
  detail: string;
  ok: boolean;
} {
  if (health === undefined) {
    return { label: '○ Checking…', detail: '', ok: false };
  }

  switch (health) {
    case 'ready':
      return {
        label: '● Connected',
        detail: 'Ready to split songs.',
        ok: true,
      };

    case 'unreachable':
      return {
        label: '○ Not reachable',
        detail:
          'Nothing answered at this address. Check that the stem server is running and the address is right.',
        ok: false,
      };

    case 'unhealthy':
      return {
        label: '○ Not ready',
        detail:
          "A server answered but can't split songs: its model failed to load, or this isn't a SightKick stem server. Check the server's log.",
        ok: false,
      };

    default:
      return assertNever(health, 'stem server health');
  }
}

/** Browser build only: where the optional stem-splitting server runs. */
export function StemServerSettings() {
  const { stemToolsStatus } = useStemToolsContext();
  // Older replies (or the desktop shape) carry no stemServer: fall back on
  // the plain ready / not-ready status.
  const [health, setHealth] = useState<StemServerHealth | undefined>(
    stemToolsStatus === 'ready' ? 'ready' : undefined,
  );

  useEffect(() => {
    const off = window.electron.ipcRenderer.on<IpcCheckStemToolsResponse>(
      'check-stem-tools',
      (response) =>
        setHealth(
          response.stemServer ??
            (response.status === 'ready' ? 'ready' : 'unreachable'),
        ),
    );

    // The first check ran before settings opened: ask again for the detail.
    window.electron.ipcRenderer.sendMessage('check-stem-tools');

    return off;
  }, []);

  const [savedUrl, setSavedUrl] = usePersisted(
    STEM_SERVER_URL_KEY,
    DEFAULT_URL,
  );
  const [draft, setDraft] = useState(savedUrl);
  const [quality, setQuality] = usePersisted<StemQuality>(
    STEM_QUALITY_KEY,
    'fast',
  );
  const status = describeHealth(health);
  const check = (url: string) => {
    setSavedUrl(url.trim() || DEFAULT_URL);
    // usePersisted writes localStorage in an effect; check after it lands.
    setTimeout(
      () => window.electron.ipcRenderer.sendMessage('check-stem-tools'),
      0,
    );
  };

  return (
    <div className="flex flex-col gap-2" data-testid="stem-server-settings">
      <div className="flex items-center justify-between gap-3">
        <SettingLabel
          label="Stem server"
          tooltip="Run the SightKick stem server (stem-server/ in the repo) to split songs that have no separate drum track."
        />
        <span
          data-testid="stem-server-status"
          data-health={health ?? 'checking'}
          title={status.detail}
          className={
            status.ok ? 'text-xs text-green-500' : 'text-xs text-text-faint'
          }
        >
          {status.label}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          size="small"
          value={draft}
          placeholder={DEFAULT_URL}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={() => check(draft)}
          data-testid="stem-server-url"
        />
        <Tooltip title="Connect" placement="bottom">
          <Button
            size="small"
            icon={<FontAwesomeIcon icon={faArrowsRotate} />}
            onClick={() => check(draft)}
            data-testid="stem-server-check"
          />
        </Tooltip>
      </div>
      <div className="flex items-center justify-between gap-3">
        <SettingLabel
          label="Split quality"
          tooltip="Fast uses HTDemucs, the same model as the desktop app. Best uses BS-RoFormer-SW: cleaner drums, but several times slower."
        />
        <div className="flex items-center gap-1" data-testid="stem-quality">
          {STEM_QUALITIES.map((value) => (
            <Button
              key={value}
              size="small"
              data-testid={`stem-quality-${value}`}
              type={quality === value ? 'primary' : 'default'}
              onClick={() => setQuality(value)}
            >
              {value === 'fast' ? 'Fast' : 'Best'}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
