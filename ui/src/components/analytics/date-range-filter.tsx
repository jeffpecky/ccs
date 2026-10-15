/**
 * Date Range Filter Component
 *
 * Provides date range selection with preset options for analytics.
 * Uses react-day-picker for date selection UI within a Popover.
 */

import React from 'react';
import { format, subDays } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTranslation } from 'react-i18next';

interface DateRangeFilterProps {
  value?: DateRange;
  onChange: (dateRange: DateRange | undefined) => void;
  presets?: Array<{
    label: string;
    range: DateRange;
  }>;
  className?: string;
}

export function DateRangeFilter({
  value,
  onChange,
  presets = [
    {
      label: 'Last 7 days',
      range: {
        from: subDays(new Date(), 7),
        to: new Date(),
      },
    },
    {
      label: 'Last 30 days',
      range: {
        from: subDays(new Date(), 30),
        to: new Date(),
      },
    },
    {
      label: 'Last 90 days',
      range: {
        from: subDays(new Date(), 90),
        to: new Date(),
      },
    },
  ],
  className,
}: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const { t } = useTranslation();

  // Helper to check if a preset is currently selected
  const isPresetSelected = (presetRange: DateRange) => {
    if (!value || !value.from || !value.to || !presetRange.from || !presetRange.to) {
      return false;
    }

    // Compare dates (ignoring time components if needed, but day-picker usually returns start of day)
    // Simple comparison using formatted strings or timestamps
    return (
      format(value.from, 'yyyy-MM-dd') === format(presetRange.from, 'yyyy-MM-dd') &&
      format(value.to, 'yyyy-MM-dd') === format(presetRange.to, 'yyyy-MM-dd')
    );
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {presets.map((preset) => (
        <Button
          key={preset.label}
          variant={isPresetSelected(preset.range) ? 'default' : 'outline'}
          size="sm"
          onClick={() => onChange(preset.range)}
        >
          {preset.label}
        </Button>
      ))}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={'outline'}
            className={cn(
              'w-auto min-w-[200px] sm:min-w-[240px] justify-start text-left font-normal',
              !value && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value?.from ? (
              value.to ? (
                <>
                  {format(value.from, 'LLL dd, y')} - {format(value.to, 'LLL dd, y')}
                </>
              ) : (
                format(value.from, 'LLL dd, y')
              )
            ) : (
              <span>{t('dateRangeFilter.pickADate')}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={value?.from}
            selected={value}
            onSelect={onChange}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
