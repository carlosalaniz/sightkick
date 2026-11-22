import { useState } from 'react';
import { Button, Input } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import { usePersisted } from '../../hooks/usePersisted';
import { useStemToolsContext } from '../../context/StemToolsContext';
import { SettingLabel } from '../SettingsButton/SettingLabel';
import { Tooltip } from '../Tooltip';

// Must match src/web/stem-server.ts.
const URL_KEY = 'settings.stemServerUrl';
const QUALITY_KEY = 'settings.stemQuality';
const DEFAULT_URL = 'http://localhost:8765';

/** Browser build only: where the optional stem-splitting server runs. */
export function StemServerSettings() {
  const { stemToolsStatus } = useStemToolsContext();
  const [savedUrl, setSavedUrl] = usePersisted(URL_KEY, DEFAULT_URL);
  const [draft, setDraft] = useState(savedUrl);
  const [quality, setQuality] = usePersisted<'fast' | 'best'>(
    QUALITY_KEY,
    'fast',
  );
  const connected = stemToolsStatus === 'ready';
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
          className={
            connected ? 'text-xs text-green-500' : 'text-xs text-text-faint'
          }
        >
          {connected ? '● Connected' : '○ Not connected'}
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
          {(['fast', 'best'] as const).map((value) => (
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
