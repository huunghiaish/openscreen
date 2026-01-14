import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Video } from 'lucide-react';
import type { CameraPipConfig, CameraPipPosition, CameraPipSize } from './types';

interface CameraPipSettingsProps {
  config: CameraPipConfig;
  onConfigChange: (config: Partial<CameraPipConfig>) => void;
}

const POSITIONS: { id: CameraPipPosition; label: string }[] = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-right', label: 'Bottom Right' },
];

const SIZES: { id: CameraPipSize; label: string }[] = [
  { id: 'small', label: 'S' },
  { id: 'medium', label: 'M' },
  { id: 'large', label: 'L' },
];

export function CameraPipSettings({ config, onConfigChange }: CameraPipSettingsProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Video className="w-4 h-4 text-[#34B27B]" />
        <span className="text-sm font-medium text-slate-200">Camera PiP</span>
      </div>

      {/* Enable Toggle */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 mb-3">
        <span className="text-xs font-medium text-slate-200">Show Camera</span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => onConfigChange({ enabled })}
          className="data-[state=checked]:bg-[#34B27B]"
        />
      </div>

      {config.enabled && (
        <>
          {/* Position Selector */}
          <div className="mb-3">
            <div className="text-xs font-medium text-slate-400 mb-2">Position</div>
            <div className="grid grid-cols-2 gap-2 w-24">
              {POSITIONS.map((pos) => (
                <button
                  key={pos.id}
                  onClick={() => onConfigChange({ position: pos.id })}
                  aria-label={`Position ${pos.label}`}
                  aria-pressed={config.position === pos.id}
                  className={cn(
                    'w-10 h-10 rounded-lg border-2 transition-all flex items-center justify-center',
                    config.position === pos.id
                      ? 'border-[#34B27B] bg-[#34B27B]/20'
                      : 'border-white/10 bg-white/5 hover:border-white/20'
                  )}
                >
                  <div
                    className={cn(
                      'w-3 h-3 rounded-full',
                      config.position === pos.id ? 'bg-[#34B27B]' : 'bg-slate-500'
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Size Selector */}
          <div>
            <div className="text-xs font-medium text-slate-400 mb-2">Size</div>
            <div className="flex gap-2">
              {SIZES.map((size) => (
                <button
                  key={size.id}
                  onClick={() => onConfigChange({ size: size.id })}
                  aria-label={`Size ${size.id}`}
                  aria-pressed={config.size === size.id}
                  className={cn(
                    'flex-1 py-2 rounded-lg border transition-all text-xs font-medium',
                    config.size === size.id
                      ? 'border-[#34B27B] bg-[#34B27B]/20 text-[#34B27B]'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20'
                  )}
                >
                  {size.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
