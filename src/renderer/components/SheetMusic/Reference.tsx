import { CSSProperties, useEffect, useRef } from 'react';
import { Divider } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { cn } from '../../cn';
import { KIT_ELEMENTS } from '../../constants';
import { elementIcon } from '../../helpers';
import { faCircle, faGreaterThan } from '@fortawesome/free-solid-svg-icons';
import themedark from '../../theme';
import { InputElement, InputMapping } from '../../../types';
import { inputBus } from '../../input';

const FLASH_CLASS = 'sk-pad-flash';

interface ReferenceProps {
  className?: string;
  /** When set, the matching entry lights up each time a mapped pad is hit. */
  inputMapping?: InputMapping;
}

/** Restarts the CSS animation even when hits come faster than it lasts. */
function flash(el: HTMLElement) {
  el.classList.remove(FLASH_CLASS);
  // Reading layout forces the browser to drop the old animation.
  void el.offsetWidth;
  el.classList.add(FLASH_CLASS);
}

function usePadFlash(inputMapping: InputMapping | undefined) {
  const itemRefs = useRef(new Map<InputElement, HTMLElement>());

  useEffect(() => {
    if (!inputMapping) {
      return undefined;
    }

    const elementsByControl = new Map<string, InputElement[]>();

    Object.entries(inputMapping).forEach(([element, controls]) => {
      controls?.forEach((controlId: string) => {
        const list = elementsByControl.get(controlId) ?? [];

        list.push(element as InputElement);
        elementsByControl.set(controlId, list);
      });
    });

    return inputBus.subscribe(({ controlId, value }) => {
      if (value === 0) {
        return;
      }

      elementsByControl.get(controlId)?.forEach((element) => {
        const el = itemRefs.current.get(element);

        if (el) {
          flash(el);
        }
      });
    });
  }, [inputMapping]);

  return (element: InputElement) => (el: HTMLElement | null) => {
    if (el) {
      itemRefs.current.set(element, el);
    } else {
      itemRefs.current.delete(element);
    }
  };
}

export function Reference({ className, inputMapping }: ReferenceProps) {
  const itemRef = usePadFlash(inputMapping);

  return (
    <div
      className={cn(
        'bg-paper-light px-2 py-1 rounded-xl border border-ink/13 text-ink shadow-paper-strong flex items-center',
        className,
      )}
    >
      {[...KIT_ELEMENTS.values()].map((element, index) => {
        return (
          <div key={element.value} className="flex items-center">
            {index > 0 && <Divider vertical className="bg-ink/13" />}
            <div
              ref={itemRef(element.value)}
              data-testid={`reference-${element.value}`}
              className="sk-pad px-2 py-0.2 flex items-center gap-2 text-nowrap rounded-lg"
              style={{ '--pad-color': element.color } as CSSProperties}
              onAnimationEnd={(event) =>
                event.currentTarget.classList.remove(FLASH_CLASS)
              }
            >
              <FontAwesomeIcon
                icon={elementIcon(element.type)}
                color={element.color}
                size="lg"
              />
              <div className="font-ui font-semibold">{element.displayName}</div>
            </div>
          </div>
        );
      })}
      <div className="flex items-center">
        <Divider vertical className="bg-ink/13" />
        <div className="px-2 py-0.2 flex items-center gap-2 text-nowrap">
          <FontAwesomeIcon
            icon={faGreaterThan}
            color={themedark.color.ink}
            size="lg"
          />
          <div className="font-ui font-semibold">Hit hard</div>
        </div>
      </div>

      <div className="flex items-center">
        <Divider vertical className="bg-ink/13" />
        <div className="px-2 py-0.2 flex items-center gap-2 text-nowrap">
          <div className="font-display flex items-center">
            <div className="text-xl mt-0.75">(</div>
            <FontAwesomeIcon icon={faCircle} color={themedark.color.ink} />
            <div className="text-xl mt-0.75">)</div>
          </div>
          <div className="font-ui font-semibold">Hit softly</div>
        </div>
      </div>
    </div>
  );
}
