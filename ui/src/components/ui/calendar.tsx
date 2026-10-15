import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { DayPicker } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button-variants';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-2', className)}
      classNames={{
        root: 'relative',
        months: 'flex flex-col sm:flex-row gap-2 sm:gap-4',
        month: 'flex flex-col gap-2',
        month_caption: 'flex justify-center pt-1 relative items-center h-8',
        caption_label: 'text-sm font-medium',
        nav: 'absolute inset-x-0 top-2 flex items-center justify-between px-1 z-10',
        button_previous: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 hover:bg-accent rounded-md'
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 hover:bg-accent rounded-md'
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex w-full',
        weekday: 'text-muted-foreground w-8 font-normal text-xs text-center',
        weeks: 'flex flex-col',
        week: 'flex w-full',
        day: cn(
          'relative h-8 w-8 p-0 text-center text-xs font-normal focus-within:relative focus-within:z-20',
          'hover:bg-accent hover:text-accent-foreground rounded-full select-none'
        ),
        day_button: cn(
          buttonVariants({ variant: 'ghost' }),
          'h-8 w-8 p-0 font-normal rounded-full text-xs',
          'aria-selected:opacity-100'
        ),
        // Range Selection Styles
        range_start: cn(
          'aria-selected:bg-primary aria-selected:text-primary-foreground',
          'aria-selected:rounded-l-full aria-selected:rounded-r-none',
          'aria-selected:hover:bg-primary aria-selected:hover:text-primary-foreground'
        ),
        range_end: cn(
          'aria-selected:bg-primary aria-selected:text-primary-foreground',
          'aria-selected:rounded-r-full aria-selected:rounded-l-none',
          'aria-selected:hover:bg-primary aria-selected:hover:text-primary-foreground'
        ),
        range_middle: cn(
          'aria-selected:bg-accent aria-selected:text-accent-foreground',
          'aria-selected:rounded-none'
        ),
        selected: cn(
          'bg-primary text-primary-foreground rounded-full',
          'hover:bg-primary hover:text-primary-foreground',
          'focus:bg-primary focus:text-primary-foreground'
        ),
        today: 'bg-accent text-accent-foreground rounded-full',
        outside:
          'text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className, ...props }) => {
          const Icon =
            orientation === 'left'
              ? ChevronLeft
              : orientation === 'right'
                ? ChevronRight
                : orientation === 'up'
                  ? ChevronUp
                  : ChevronDown;
          return <Icon className={cn('h-4 w-4', className)} {...props} />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
