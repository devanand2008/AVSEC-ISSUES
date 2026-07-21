import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { isAllowedOriginFromConfig } from "./common/http/allowed-origins";
import { SerializationInterceptor } from "./common/http/serialization.interceptor";
import { RedisIoAdapter } from "./common/realtime/redis-io.adapter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  const prefix = config.get<string>("API_PREFIX", "api/v1");
  const trustedProxyHops = config.get<number | false>("TRUST_PROXY", false);

  if (trustedProxyHops !== false) {
    app.getHttpAdapter().getInstance().set("trust proxy", trustedProxyHops);
  }

  app.setGlobalPrefix(prefix);
  app.use(cookieParser());
  app.use(compression());
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || isAllowedOriginFromConfig(config, origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Request origin is not allowed."), false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-csrf-token",
      "x-request-id",
      "idempotency-key",
    ],
    exposedHeaders: ["x-request-id"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );
  app.useGlobalInterceptors(new SerializationInterceptor());
  const socketAdapter = new RedisIoAdapter(app);
  await socketAdapter.connect(config.getOrThrow<string>("REDIS_URL"));
  app.useWebSocketAdapter(socketAdapter);
  app.enableShutdownHooks();

  if (config.get<boolean>("SWAGGER_ENABLED", false)) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("College Administration API")
      .setDescription(
        "Versioned API for attendance, issues, communications and administration",
      )
      .setVersion("2.0")
      .addCookieAuth("college_access")
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      "api/docs",
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
      {
        swaggerOptions: { persistAuthorization: false },
      },
    );
  }

  await app.listen(config.get<number>("PORT", 4000), "0.0.0.0");
}

void bootstrap();
