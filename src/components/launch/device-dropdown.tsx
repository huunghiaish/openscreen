/**
 * Base device dropdown component for camera/mic selection.
 * Glass morphism styling matching HUD overlay aesthetic.
 * Opens upward to avoid obscuring main controls.
 * Supports keyboard navigation and screen readers (ARIA).
 */
import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';

interface DeviceDropdownProps {
  icon: ReactNode;
  /** Accessible label for screen readers */
  ariaLabel: string;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string | null) => void;
  disabled?: boolean;
  /** Extra content rendered above device list (level meter, settings) */
  headerContent?: ReactNode;
  /** Enable click-to-toggle behavior (single click = toggle on/off, dropdown via arrow) */
  enableClickToggle?: boolean;
  /** Last used device ID for toggle-on (when enableClickToggle is true) */
  lastUsedDeviceId?: string | null;
}

export function DeviceDropdown({
  icon,
  ariaLabel,
  devices,
  selectedDeviceId,
  onSelectDevice,
  disabled = false,
  headerContent,
  enableClickToggle = false,
  lastUsedDeviceId,
}: DeviceDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // All selectable options: [null (None), ...device IDs]
  const options = useMemo(
    () => [null, ...devices.map((d) => d.deviceId)],
    [devices]
  );

  // Close dropdown on outside click - always register to avoid memory leak
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (isOpen && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on escape key - always register to avoid memory leak
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (isOpen && event.key === 'Escape') {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus management - scroll focused item into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[role="option"]');
      items[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, focusedIndex]);

  // Get current selected index
  const getSelectedIndex = useCallback(() => {
    return options.findIndex((id) => id === selectedDeviceId);
  }, [options, selectedDeviceId]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isOpen) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
          event.preventDefault();
          setIsOpen(true);
          setFocusedIndex(Math.max(0, getSelectedIndex()));
        }
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, options.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Home':
          event.preventDefault();
          setFocusedIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setFocusedIndex(options.length - 1);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < options.length) {
            onSelectDevice(options[focusedIndex]);
            setIsOpen(false);
            setFocusedIndex(-1);
          }
          break;
        case 'Tab':
          setIsOpen(false);
          setFocusedIndex(-1);
          break;
      }
    },
    [isOpen, focusedIndex, options, onSelectDevice, getSelectedIndex]
  );

  const handleSelect = useCallback(
    (deviceId: string | null) => {
      onSelectDevice(deviceId);
      setIsOpen(false);
      setFocusedIndex(-1);
    },
    [onSelectDevice]
  );

  const selectedIndex = getSelectedIndex();

  // Handle icon click - either toggle or open dropdown
  // Use fresh values directly instead of stale closure
  const handleIconClick = () => {
    if (enableClickToggle) {
      // Toggle behavior: turn off if active, turn on with last device or first available
      const currentlyActive = selectedDeviceId !== null;
      if (currentlyActive) {
        onSelectDevice(null);
      } else {
        // Turn on: use last used device or first available device
        const deviceToSelect = lastUsedDeviceId && devices.some(d => d.deviceId === lastUsedDeviceId)
          ? lastUsedDeviceId
          : devices.length > 0
            ? devices[0].deviceId
            : null;
        if (deviceToSelect) {
          onSelectDevice(deviceToSelect);
        }
      }
    } else {
      // Default behavior: open dropdown
      setIsOpen(!isOpen);
      if (!isOpen) setFocusedIndex(Math.max(0, selectedIndex));
    }
  };

  const isActive = selectedDeviceId !== null;

  // Handle dropdown arrow click (for toggle mode)
  const handleDropdownArrowClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
    if (!isOpen) setFocusedIndex(Math.max(0, selectedIndex));
  };

  return (
    <div
      ref={dropdownRef}
      className="relative"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center">
        <Button
          variant="link"
          size="icon"
          onClick={handleIconClick}
          disabled={disabled}
          className="bg-transparent hover:bg-transparent px-1"
          style={{ opacity: isActive ? 1 : 0.5 }}
          aria-haspopup={enableClickToggle ? undefined : 'listbox'}
          aria-expanded={enableClickToggle ? undefined : isOpen}
          aria-label={ariaLabel}
          aria-pressed={enableClickToggle ? isActive : undefined}
        >
          {icon}
        </Button>
        {/* Dropdown arrow for toggle mode */}
        {enableClickToggle && (
          <button
            type="button"
            onClick={handleDropdownArrowClick}
            disabled={disabled}
            className="text-white/50 hover:text-white/80 -ml-1 pr-1"
            style={{ opacity: disabled ? 0.3 : 0.6, fontSize: 8 }}
            aria-label={`${ariaLabel} options`}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
          >
            ▼
          </button>
        )}
      </div>

      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={focusedIndex >= 0 ? `device-option-${focusedIndex}` : undefined}
          tabIndex={-1}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 8,
            minWidth: 200,
            maxHeight: 300,
            overflowY: 'auto',
            background: 'rgba(30,30,40,0.95)',
            backdropFilter: 'blur(16px)',
            borderRadius: 12,
            border: '1px solid rgba(80,80,120,0.3)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            padding: 8,
            zIndex: 100,
          }}
        >
          {/* Custom content (settings, level meter) */}
          {headerContent}

          {headerContent && <div className="border-t border-white/10 my-2" />}

          {/* None option */}
          <div
            id="device-option-0"
            role="option"
            aria-selected={selectedDeviceId === null}
            onClick={() => handleSelect(null)}
            onMouseEnter={() => setFocusedIndex(0)}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-sm text-white/80 cursor-pointer"
            style={{
              background:
                focusedIndex === 0
                  ? 'rgba(255,255,255,0.15)'
                  : selectedDeviceId === null
                    ? 'rgba(255,255,255,0.1)'
                    : 'transparent',
            }}
          >
            None
          </div>

          {/* Device list */}
          {devices.map((device, idx) => {
            const optionIndex = idx + 1; // +1 because None is at index 0
            return (
              <div
                key={device.deviceId}
                id={`device-option-${optionIndex}`}
                role="option"
                aria-selected={selectedDeviceId === device.deviceId}
                onClick={() => handleSelect(device.deviceId)}
                onMouseEnter={() => setFocusedIndex(optionIndex)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-sm text-white/80 cursor-pointer"
                style={{
                  background:
                    focusedIndex === optionIndex
                      ? 'rgba(255,255,255,0.15)'
                      : selectedDeviceId === device.deviceId
                        ? 'rgba(255,255,255,0.1)'
                        : 'transparent',
                }}
              >
                {device.label || `Unknown Device (${device.deviceId.slice(0, 8)})`}
              </div>
            );
          })}

          {devices.length === 0 && (
            <div className="px-3 py-2 text-sm text-white/40" role="status">
              No devices found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
