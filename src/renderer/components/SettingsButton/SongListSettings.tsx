import { Button, Divider, Progress } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowsRotate,
  faDrum,
  faFolder,
  faHardDrive,
} from '@fortawesome/free-solid-svg-icons';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { StemToolsPanel } from '../../context/StemToolsContext';
import { useApp } from '../../context/AppContext';
import { Tooltip } from '../Tooltip';
import { SupportButton } from '../SupportButton/SupportButton';
import { DISCORD_URL } from './constants';
import { IS_WEB } from '../../platform';

// Must match BROWSER_ROOT_NAME in src/web/library.ts.
const BROWSER_STORAGE = 'Browser storage';
const canPickFolder = () =>
  typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
  'function';

function folderTooltip(currentPath: string | null | undefined) {
  if (!IS_WEB) {
    return currentPath ?? 'Point this at the folder where your songs will live';
  }

  if (!canPickFolder()) {
    return 'Songs you download are saved in this browser. Use Chrome or Edge to open a folder on your computer instead.';
  }

  return currentPath === BROWSER_STORAGE
    ? 'Songs are saved in this browser. Click to use a folder on your computer, like your Clone Hero library.'
    : 'Pick a different folder on your computer';
}

interface Props {
  scanPercent?: number;
  onSetupInput: () => void;
  currentInputName?: string;
}

export function SongListSettings({
  scanPercent,
  onSetupInput,
  currentInputName,
}: Props) {
  const { currentPath } = useApp();
  const isScanning = scanPercent !== undefined;
  const selectFolder = () =>
    window.electron.ipcRenderer.sendMessage('rescan-songs');
  const rescan = () =>
    window.electron.ipcRenderer.sendMessage('rescan-songs', false);
  const switchToBrowserStorage = () =>
    window.electron.ipcRenderer.sendMessage('rescan-songs', 'browser');
  const showBrowserStorageButton =
    IS_WEB && !!currentPath && currentPath !== BROWSER_STORAGE;

  return (
    <>
      <div className="flex gap-2 grow">
        <Tooltip title={folderTooltip(currentPath)} placement="bottom">
          <Button
            icon={<FontAwesomeIcon icon={faFolder} />}
            onClick={selectFolder}
            disabled={isScanning}
            className="grow"
          >
            {currentPath ? currentPath.split(/[\\/]/).pop() : 'Select folder'}
          </Button>
        </Tooltip>
        {showBrowserStorageButton ? (
          <Tooltip
            title="Switch back to songs saved in this browser"
            placement="bottom"
          >
            <Button
              icon={<FontAwesomeIcon icon={faHardDrive} />}
              data-testid="use-browser-storage"
              onClick={switchToBrowserStorage}
              disabled={isScanning}
            />
          </Tooltip>
        ) : null}
        {currentPath ? (
          <Tooltip
            title="Picks up any songs you've added since last time"
            placement="bottomLeft"
          >
            <Button
              icon={<FontAwesomeIcon icon={faArrowsRotate} />}
              data-testid="rescan-folder"
              onClick={rescan}
            />
          </Tooltip>
        ) : null}
      </div>
      {isScanning && (
        <div className="flex flex-col gap-1" data-testid="scan-progress">
          <div className="text-sm text-text-muted">Scanning songs</div>
          <Progress percent={scanPercent} />
        </div>
      )}

      <Tooltip
        title="Hook up your e-kit (or keyboard) so we can score your hits"
        placement="bottom"
      >
        <Button
          data-testid="setup-input"
          icon={<FontAwesomeIcon icon={faDrum} />}
          onClick={onSetupInput}
        >
          {currentInputName ?? 'Setup input'}
        </Button>
      </Tooltip>

      <Divider />

      {IS_WEB ? null : (
        <>
          <StemToolsPanel />

          <Divider />
        </>
      )}

      <Tooltip title="Join the community" placement="bottom">
        <Button
          icon={<FontAwesomeIcon icon={faDiscord} />}
          onClick={() => window.open(DISCORD_URL)}
        >
          Discord
        </Button>
      </Tooltip>

      <SupportButton />
    </>
  );
}
