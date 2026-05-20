'use client';

import * as RadixSelect from '@radix-ui/react-select';
import { CheckIcon, ChevronDownIcon } from './icons';

const EMPTY_SELECT_VALUE = '__rootpilot_empty__';

export function SelectControl({
  value,
  onChange,
  options,
  className,
  triggerClassName,
  contentClassName,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  'aria-label': string;
}) {
  const normalizedValue = options.some((option) => option.value === value)
    ? value
    : (options[0]?.value ?? '');

  return (
    <div className={className}>
      <RadixSelect.Root
        value={toRadixSelectValue(normalizedValue)}
        onValueChange={(nextValue) => onChange(fromRadixSelectValue(nextValue))}
      >
        <RadixSelect.Trigger
          aria-label={ariaLabel}
          className={cn(
            'rp-input flex h-10 items-center justify-between gap-3 px-3 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-400/40 data-[state=open]:border-cyan-400/50 data-[state=open]:bg-cyan-400/10',
            triggerClassName,
          )}
        >
          <RadixSelect.Value />
          <RadixSelect.Icon aria-hidden="true">
            <ChevronDownIcon className="h-4 w-4 text-slate-500" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={6}
            className={cn(
              'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-surface-border bg-slate-950/95 text-sm text-slate-200 shadow-2xl shadow-black/40 backdrop-blur',
              contentClassName,
            )}
          >
            <RadixSelect.Viewport className="p-1">
              {options.map((option) => (
                <RadixSelect.Item
                  key={`${option.value || EMPTY_SELECT_VALUE}-${option.label}`}
                  value={toRadixSelectValue(option.value)}
                  className="relative flex h-9 cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-cyan-400/10 data-[highlighted]:text-cyan-100 data-[state=checked]:text-white"
                >
                  <RadixSelect.ItemIndicator className="absolute left-2 flex h-4 w-4 items-center justify-center text-cyan-300">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </RadixSelect.ItemIndicator>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}

function toRadixSelectValue(value: string): string {
  return value === '' ? EMPTY_SELECT_VALUE : value;
}

function fromRadixSelectValue(value: string): string {
  return value === EMPTY_SELECT_VALUE ? '' : value;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}
