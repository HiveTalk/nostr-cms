import { useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { format } from 'date-fns'
import { DateRange } from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { CustomDateRange } from '@/types/zaplytics'

interface DateRangePickerProps {
  value?: CustomDateRange
  onChange: (dateRange?: CustomDateRange) => void
  className?: string
}

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [tempRange, setTempRange] = useState<DateRange | undefined>(undefined)

  const selectedRange: DateRange | undefined = value
    ? { from: value.from, to: value.to }
    : tempRange

  const handleSelect = (range: DateRange | undefined) => {
    // If range is cleared
    if (!range) {
      setTempRange(undefined)
      onChange(undefined)
      return
    }

    // If we have both from and to dates
    if (range.from && range.to) {
      // Validate that the range is not more than 90 days
      const daysDifference = Math.ceil(
        (range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24)
      )
      
      if (daysDifference > 90) {
        // Don't update if range is too long, but keep the selection visual
        setTempRange(range)
        return
      }

      // Valid complete range - apply it and close picker
      setTempRange(undefined)
      onChange({ from: range.from, to: range.to })
      setIsOpen(false)
    } else if (range.from) {
      // Only start date selected, store temporarily and keep picker open
      setTempRange(range)
      // Don't call onChange yet - wait for complete range
    }
  }

  // Reset temp range when picker closes
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open && !value) {
      setTempRange(undefined)
    }
  }

  const getButtonText = () => {
    if (!value) {
      return "Pick a date range"
    }

    if (value.from && value.to) {
      const daysDifference = Math.ceil(
        (value.to.getTime() - value.from.getTime()) / (1000 * 60 * 60 * 24)
      )
      
      return `${format(value.from, 'MMM d')} - ${format(value.to, 'MMM d, yyyy')} (${daysDifference + 1} days)`
    }

    if (value.from) {
      return format(value.from, 'MMM d, yyyy')
    }

    return "Pick a date range"
  }

  // Calculate date constraints
  const maxDate = new Date() // Current day (today)
  
  const minDate = new Date(2023, 0, 1) // January 1, 2023

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex gap-2">
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              id="date"
              variant="outline"
              className={cn(
                "flex-1 justify-start text-left font-normal",
                !value && "text-muted-foreground"
              )}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              {getButtonText()}
            </Button>
          </PopoverTrigger>
          
          <PopoverContent className="w-auto p-0" align="start">
            <div className="p-3 border-b">
              <p className="text-sm font-medium">Select Date Range</p>
              <p className="text-xs text-muted-foreground">
                Maximum 90 days. Choose start and end dates.
              </p>
            </div>
            
            <Calendar
              autoFocus
              mode="range"
              defaultMonth={selectedRange?.from}
              selected={selectedRange}
              onSelect={handleSelect}
              numberOfMonths={2}
              disabled={(date) => {
                if (date > maxDate || date < minDate) return true;
                
                // If we have a from date, disable dates that would make range > 90 days
                const currentFrom = selectedRange?.from;
                if (currentFrom && !selectedRange?.to) {
                  const daysDifference = Math.abs((date.getTime() - currentFrom.getTime()) / (1000 * 60 * 60 * 24));
                  return daysDifference > 90;
                }
                
                return false;
              }}
            />
            
            {selectedRange?.from && selectedRange?.to && (
              <div className="p-3 border-t bg-muted/50">
                <div className="text-xs text-muted-foreground">
                  Selected: {Math.ceil((selectedRange.to.getTime() - selectedRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1} days
                  {Math.ceil((selectedRange.to.getTime() - selectedRange.from.getTime()) / (1000 * 60 * 60 * 24)) > 90 && (
                    <span className="text-destructive ml-2">
                      ⚠️ Range too long (max 90 days)
                    </span>
                  )}
                </div>
              </div>
            )}

            {selectedRange?.from && !selectedRange?.to && (
              <div className="p-3 border-t bg-muted/50">
                <div className="text-xs text-muted-foreground">
                  Start date: {format(selectedRange.from, 'MMM d, yyyy')} - Select end date
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
        
        {value && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setTempRange(undefined)
              onChange(undefined)
              setIsOpen(false)
            }}
            className="shrink-0"
            title="Clear date range"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}