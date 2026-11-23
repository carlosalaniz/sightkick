import { useState } from 'react';
import { Popover } from 'antd';
import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
import { useStemToolsContext } from '../../context/StemToolsContext';
import { popoverOpenChange, popoverStyles } from '../../overlayStyles';
import { IconButton } from '../IconButton';
import { SongMenuContent } from './SongMenuContent';
import { IS_WEB } from '../../platform';

interface Props {
  dir: string;
  canSplit: boolean;
  canSplitKit?: boolean;
  splitting: boolean;
  onSplit: () => void;
  onSplitKit?: () => void;
}

export function SongMenu({
  dir,
  canSplit,
  canSplitKit = false,
  splitting,
  onSplit,
  onSplitKit,
}: Props) {
  const { stemToolsStatus } = useStemToolsContext();
  const [isOpen, setIsOpen] = useState(false);
  const showSplit = stemToolsStatus === 'ready' && canSplit;
  const showSplitKit = stemToolsStatus === 'ready' && canSplitKit;
  const close = () => setIsOpen(false);

  // The browser build can't open folders, so its only items are splits.
  if (IS_WEB && !showSplit && !showSplitKit) {
    return null;
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={popoverOpenChange(setIsOpen)}
      trigger="click"
      placement="bottomRight"
      styles={{
        ...popoverStyles,
        container: { ...popoverStyles.container, padding: 0 },
      }}
      content={
        <div onClick={(event) => event.stopPropagation()}>
          <SongMenuContent
            showSplit={showSplit}
            showSplitKit={showSplitKit}
            splitting={splitting}
            onOpenDirectory={
              IS_WEB
                ? undefined
                : () => {
                    window.electron.ipcRenderer.sendMessage(
                      'open-song-directory',
                      dir,
                    );
                    close();
                  }
            }
            onSplit={() => {
              onSplit();
              close();
            }}
            onSplitKit={() => {
              onSplitKit?.();
              close();
            }}
          />
        </div>
      }
    >
      <IconButton
        data-testid="song-menu-trigger"
        className="mt-auto"
        icon={faEllipsisVertical}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      />
    </Popover>
  );
}
