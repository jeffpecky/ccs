/**
 * Analytics Skeleton Component
 *
 * Loading skeleton for the analytics page.
 */

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-4 h-full overflow-hidden">
      {/* Usage Trends Skeleton */}
      <Card className="flex flex-col min-h-[300px]">
        <CardHeader className="p-4 pb-2">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="p-4 pt-0 flex-1">
          <Skeleton className="h-full w-full" />
        </CardContent>
      </Card>

      {/* Bottom Row Skeletons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cost Breakdown Skeleton */}
        <Card className="flex flex-col min-h-[250px]">
          <CardHeader className="p-4 pb-2">
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Skeleton className="w-2.5 h-2.5 rounded-full" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Model Usage Skeleton */}
        <Card className="flex flex-col min-h-[250px]">
          <CardHeader className="p-4 pb-2">
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardContent className="p-4 pt-0 flex-1">
            <div className="flex w-full h-full items-center">
              <div className="flex-1 flex justify-center">
                <Skeleton className="h-[180px] w-[180px] rounded-full" />
              </div>
              <div className="w-[140px] shrink-0 pl-2 space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="w-2 h-2 rounded-full" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
