import React from "react";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "AVS Learn Portal | AVS College Management System",
  description: "Access programming courses and academic resources",
};

export default function LearnPortalPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">AVS Learn Portal</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card text-card-foreground shadow">
          <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="tracking-tight text-sm font-medium">Available Courses</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">Check back later for new programming courses.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
