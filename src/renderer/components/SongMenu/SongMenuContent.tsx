import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faDrum,
  faFolder,
  faHandScissors,
} from '@fortawesome/free-solid-svg-icons';
import { Divider } from 'antd';

interface Props {
  showSplit: boolean;
  /** Offer splitting the drums into kick, snare, toms, ... */
  showSplitKit?: boolean;
  splitting: boolean;
  onOpenDirectory?: () => void;
  onSplit: () => void;
  onSplitKit?: () => void;
}

const ITEM =
  'flex items-center gap-3 px-4 py-2 text-text-muted hover:text-text cursor-pointer bg-transparent border-0 whitespace-nowrap w-full text-left disabled:opacity-40 disabled:cursor-default';

export function SongMenuContent({
  showSplit,
  showSplitKit = false,
  splitting,
  onOpenDirectory,
  onSplit,
  onSplitKit,
}: Props) {
  return (
    <>
      {onOpenDirectory && (
        <button
          className="flex items-center gap-3 px-4 py-2 text-text-muted hover:text-text cursor-pointer bg-transparent border-0 whitespace-nowrap w-full text-left"
          onClick={onOpenDirectory}
        >
          <FontAwesomeIcon icon={faFolder} className="w-4" />
          Open song directory
        </button>
      )}

      {(showSplit || showSplitKit) && onOpenDirectory && <Divider />}

      {showSplit && (
        <button className={ITEM} disabled={splitting} onClick={onSplit}>
          <FontAwesomeIcon icon={faHandScissors} className="w-4" />
          {splitting ? 'Splitting…' : 'Split stems'}
        </button>
      )}

      {showSplitKit && (
        <button
          className={ITEM}
          data-testid="split-kit"
          disabled={splitting}
          onClick={onSplitKit}
          title="Splits the drums into kick, snare, toms, hi-hat, ride and crash, so lessons can mute just the parts you play"
        >
          <FontAwesomeIcon icon={faDrum} className="w-4" />
          {splitting ? 'Splitting…' : 'Split drum kit'}
        </button>
      )}
    </>
  );
}
