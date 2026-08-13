import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { CurrentRequestId } from "../../common/decorators/request-id.decorator";
import type { AuthPrincipal } from "../../common/http/request-context";
import {
  ConfirmStudentPromotionDto,
  PreviewStudentPromotionDto,
} from "./dto/student-promotion.dto";
import { StudentPromotionService } from "./student-promotion.service";

@ApiTags("academic")
@Permissions("academic.manage")
@Controller("academic/student-promotions")
export class StudentPromotionController {
  constructor(private readonly promotions: StudentPromotionService) {}

  @Post("preview")
  preview(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: PreviewStudentPromotionDto,
  ) {
    return this.promotions.preview(user, input);
  }

  @Post("confirm")
  confirm(
    @CurrentUser() user: AuthPrincipal,
    @Body() input: ConfirmStudentPromotionDto,
    @CurrentRequestId() requestId: string,
  ) {
    return this.promotions.confirm(user, input, requestId);
  }
}
