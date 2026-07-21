import { Module } from "@nestjs/common";
import { IssuesController } from "./issues.controller";
import { IssuesService } from "./issues.service";
import { RoutingService } from "./routing.service";
import { SlaService } from "./sla.service";
import { DuplicateSubscriptionProofService } from "./duplicate-subscription-proof.service";

@Module({ controllers: [IssuesController], providers: [IssuesService, RoutingService, SlaService, DuplicateSubscriptionProofService], exports: [IssuesService, RoutingService, SlaService] })
export class IssuesModule {}
