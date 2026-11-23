import { useState } from 'react';
import { Button, Segmented, Select } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useKit } from '../../kit';
import { BuildKit } from './BuildKit';
import { LayoutHistory } from './kitEdits';
import { LearnPads } from './LearnPads';

const TABS = [
  { value: 'build', label: '1 · Build kit' },
  { value: 'learn', label: '2 · Learn pads' },
] as const;

type Tab = (typeof TABS)[number]['value'];

const NEW_KIT = '__new';

export function KitLabView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'learn' ? 'learn' : 'build';
  const { kits, kit, selectKit, createKit } = useKit();
  // Layout undo history per kit, kept here so it survives switching tabs.
  const [history, setHistory] = useState<LayoutHistory>({});

  return (
    <div className="h-screen flex flex-col bg-bg">
      <div
        className="flex items-center p-4 gap-5 flex-wrap border-b border-divider"
        style={{ background: 'var(--gradient-header)' }}
      >
        <Button
          icon={<FontAwesomeIcon icon={faArrowLeft} />}
          data-testid="back-button"
          onClick={() => navigate(-1)}
          size="large"
        />
        <div className="font-display text-[22px] text-text">Kit lab</div>
        <Segmented
          value={tab}
          options={TABS.map((t) => ({ value: t.value, label: t.label }))}
          onChange={(value) =>
            setSearchParams({ tab: String(value) }, { replace: true })
          }
        />
        <div className="ml-auto flex items-center gap-2 text-text-muted">
          Kit
          <Select
            value={kit.id}
            style={{ minWidth: 220 }}
            options={[
              ...kits.map((k) => ({ value: k.id, label: k.name })),
              { value: NEW_KIT, label: '+ New kit…' },
            ]}
            onChange={(value) => {
              if (value === NEW_KIT) {
                createKit();
                setSearchParams({ tab: 'build' }, { replace: true });
              } else {
                selectKit(value);
              }
            }}
          />
        </div>
      </div>
      <div className="grow min-h-0 overflow-auto px-4 pt-4 pb-8 font-ui text-sm text-text-body">
        {tab === 'build' ? (
          <BuildKit history={history} setHistory={setHistory} />
        ) : (
          <LearnPads />
        )}
      </div>
    </div>
  );
}
