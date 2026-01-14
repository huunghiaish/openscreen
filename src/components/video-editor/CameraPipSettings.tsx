import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Video, Square, Circle, RectangleHorizontal } from 'lucide-react';
import type { CameraPipConfig, CameraPipPosition, CameraPipSize, CameraPipShape } from './types';

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

const SHAPES: { id: CameraPipShape; icon: typeof Square }[] = [
  { id: 'rectangle', icon: RectangleHorizontal },
  { id: 'square', icon: Square },
  { id: 'circle', icon: Circle },
];

export function CameraPipSettings({ config, onConfigChange }: CameraPipSettingsProps) {
  return (
    <div className="mb-6 p-3 rounded-xl bg-white/5 border border-white/5">
      {/* Header with toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-[#34B27B]" />
          <span className="text-xs font-medium text-slate-200">Camera PiP</span>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => onConfigChange({ enabled })}
          className="data-[state=checked]:bg-[#34B27B]"
        />
      </div>

      {config.enabled && (
        <div className="space-y-2.5">
          {/* Row 1: Position + Size side-by-side */}
          <div className="flex gap-3">
            {/* Position - 2x2 grid */}
            <div className="flex-shrink-0">
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">Pos</div>
              <div className="grid grid-cols-2 gap-1">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos.id}
                    onClick={() => onConfigChange({ position: pos.id })}
                    aria-label={`Position ${pos.label}`}
                    aria-pressed={config.position === pos.id}
                    className={cn(
                      'w-8 h-8 rounded-lg border transition-all flex items-center justify-center',
                      config.position === pos.id
                        ? 'border-[#34B27B] bg-[#34B27B]/20'
                        : 'border-white/10 bg-white/5 hover:border-white/20'
                    )}
                  >
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full',
                        config.position === pos.id ? 'bg-[#34B27B]' : 'bg-slate-500'
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Size - fills remaining space */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">Size</div>
              <div className="grid grid-cols-3 gap-1 flex-1">
                {SIZES.map((size) => (
                  <button
                    key={size.id}
                    onClick={() => onConfigChange({ size: size.id })}
                    aria-label={`Size ${size.id}`}
                    aria-pressed={config.size === size.id}
                    className={cn(
                      'rounded-lg border transition-all text-xs font-semibold',
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
          </div>

          {/* Row 2: Shape + Corner Radius side-by-side */}
          <div className="flex gap-3 items-end">
            {/* Shape - icon-only buttons */}
            <div className="flex-shrink-0">
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">Shape</div>
              <div className="flex gap-1">
                {SHAPES.map((shape) => {
                  const Icon = shape.icon;
                  return (
                    <button
                      key={shape.id}
                      onClick={() => onConfigChange({ shape: shape.id })}
                      aria-label={`Shape ${shape.id}`}
                      aria-pressed={config.shape === shape.id}
                      title={shape.id.charAt(0).toUpperCase() + shape.id.slice(1)}
                      className={cn(
                        'w-8 h-8 rounded-lg border transition-all flex items-center justify-center',
                        config.shape === shape.id
                          ? 'border-[#34B27B] bg-[#34B27B]/20'
                          : 'border-white/10 bg-white/5 hover:border-white/20'
                      )}
                    >
                      <Icon
                        className={cn(
                          'w-4 h-4',
                          config.shape === shape.id ? 'text-[#34B27B]' : 'text-slate-400'
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Corner Radius slider */}
            {config.shape !== 'circle' && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Radius</div>
                  <span className="text-[10px] text-slate-400 font-mono">{config.borderRadius}%</span>
                </div>
                <Slider
                  value={[config.borderRadius]}
                  onValueChange={([value]) => onConfigChange({ borderRadius: value })}
                  min={0}
                  max={50}
                  step={1}
                  className="w-full"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
