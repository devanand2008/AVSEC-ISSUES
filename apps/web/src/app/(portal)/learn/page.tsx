import React from "react";
import { Metadata } from "next";
import { LearnPortalClient } from "./learn-portal-client";

export const metadata: Metadata = {
  title: "AVS Learn Portal | AVS College Management System",
  description: "Access programming courses and academic resources",
};

export default function LearnPortalPage() {
  return <LearnPortalClient />;
}
