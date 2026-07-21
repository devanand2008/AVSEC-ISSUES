$ErrorActionPreference = "Stop"

$rootPath = [System.IO.Path]::GetFullPath("$PSScriptRoot\..")
Set-Location $rootPath

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  AVS COLLEGE MANAGEMENT - SAFE GIT PUSH" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command "git" -ErrorAction SilentlyContinue)) {
    Write-Error "Git is not installed or not available in PATH."
    exit 1
}

if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed or not available in PATH."
    exit 1
}

try {
    $isGitRepo = git rev-parse --is-inside-work-tree 2>$null
    if ($isGitRepo -ne "true") {
        Write-Error "Current directory ($rootPath) is not a Git repository."
        exit 1
    }
} catch {
    Write-Error "Current directory ($rootPath) is not a Git repository."
    exit 1
}

Write-Host "[1/9] Running preflight sensitive-file scanner..." -ForegroundColor Yellow
node scripts/check-sensitive-files.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Preflight sensitive-file scanner failed. Push aborted."
    exit 1
}

Write-Host "[2/9] Checking Git status..." -ForegroundColor Yellow
git status --short

$stagedBefore = git diff --cached --name-only
foreach ($file in $stagedBefore) {
    $norm = $file.Replace("\", "/")
    if ($norm -match "^user_data/" -and $norm -ne "user_data/.gitkeep" -and $norm -ne "user_data/README_SECURITY.txt" -and $norm -ne "user_data/templates/student-import-template.xlsx") {
        Write-Error "Unsafe user_data file is currently staged: $file. Push aborted."
        exit 1
    }
    if ($norm -match "^\.env($|\..*)") {
        if ($norm -ne ".env.example") {
            Write-Error "Unsafe environment file is currently staged: $file. Push aborted."
            exit 1
        }
    }
    if ($norm -match "^(certs/|mkcert-master/|.*rootCA)") {
        Write-Error "Private certificate or CA key is currently staged: $file. Push aborted."
        exit 1
    }
}

Write-Host "[3/9] Running frontend unit tests (@college/web)..." -ForegroundColor Yellow
npm run test -w @college/web --if-present
if ($LASTEXITCODE -ne 0) {
    Write-Error "Frontend tests failed. Push aborted."
    exit 1
}

Write-Host "[4/9] Running backend unit tests (@college/api)..." -ForegroundColor Yellow
npm run test -w @college/api --if-present
if ($LASTEXITCODE -ne 0) {
    Write-Error "Backend tests failed. Push aborted."
    exit 1
}

Write-Host "[5/9] Running frontend production build (@college/web)..." -ForegroundColor Yellow
npm run build -w @college/web
if ($LASTEXITCODE -ne 0) {
    Write-Error "Frontend production build failed. Push aborted."
    exit 1
}

Write-Host "[6/9] Running backend schema validation and build (@college/api)..." -ForegroundColor Yellow
npm run prisma:validate -w @college/api
if ($LASTEXITCODE -ne 0) {
    Write-Error "Backend Prisma schema validation failed. Push aborted."
    exit 1
}
npm run build -w @college/api
if ($LASTEXITCODE -ne 0) {
    Write-Error "Backend production build failed. Push aborted."
    exit 1
}

Write-Host "[7/9] Validating Render Blueprint..." -ForegroundColor Yellow
node scripts/validate-render-config.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Render Blueprint validation failed. Push aborted."
    exit 1
}

Write-Host "[8/9] Staging safe repository source files..." -ForegroundColor Yellow
$safeTargets = @(
    ".gitignore",
    ".gitattributes",
    ".dockerignore",
    ".env.example",
    "package.json",
    "package-lock.json",
    "eslint.config.mjs",
    "render.yaml",
    "GIT_SAFE_PUSH.bat",
    "START_AVS_APP.bat",
    "README.md",
    "scripts",
    "apps/api/src",
    "apps/api/prisma",
    "apps/api/test",
    "apps/api/package.json",
    "apps/api/jest.config.cjs",
    "apps/api/nest-cli.json",
    "apps/api/prisma.config.ts",
    "apps/api/tsconfig.json",
    "apps/api/tsconfig.build.json",
    "apps/api/Dockerfile",
    "apps/web/src",
    "apps/web/public",
    "apps/web/e2e",
    "apps/web/package.json",
    "apps/web/next.config.ts",
    "apps/web/eslint.config.mjs",
    "apps/web/postcss.config.mjs",
    "apps/web/playwright.config.ts",
    "apps/web/vitest.config.ts",
    "apps/web/tsconfig.json",
    "apps/web/Dockerfile",
    "packages",
    "user_data/.gitkeep",
    "user_data/README_SECURITY.txt",
    "user_data/templates/student-import-template.xlsx",
    ".github"
)

foreach ($target in $safeTargets) {
    if (Test-Path -Path $target) {
        git add $target
    }
}

Write-Host "Verifying staged files post-add..." -ForegroundColor Cyan
$stagedFiles = git diff --cached --name-only
if (-not $stagedFiles) {
    Write-Host "No changes staged for commit. Repository is up-to-date and clean." -ForegroundColor Green
    exit 0
}

Write-Host "Staged files for commit:" -ForegroundColor Cyan
$stagedFiles | ForEach-Object { Write-Host "  + $_" }

$forbiddenPatterns = @(
    "^user_data/(?!((\.gitkeep$)|(README_SECURITY\.txt$)|(templates/student-import-template\.xlsx$)))",
    "^\.env(?!\.example$)",
    "^certs/",
    "^mkcert-master/",
    "rootCA",
    "credential-exports",
    "import-results"
)

foreach ($file in $stagedFiles) {
    $norm = $file.Replace("\", "/")
    foreach ($pattern in $forbiddenPatterns) {
        if ($norm -match $pattern) {
            Write-Error "CRITICAL: Staged file '$file' matched forbidden security pattern '$pattern'. Push aborted."
            exit 1
        }
    }
}

node scripts/check-sensitive-files.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Preflight verification after staging failed. Push aborted."
    exit 1
}

Write-Host "[9/9] Committing and pushing to origin/main..." -ForegroundColor Yellow
$commitMsg = $args[0]
if (-not $commitMsg) {
    $commitMsg = Read-Host "Enter commit message"
    if (-not $commitMsg) {
        Write-Error "Commit message is required. Push aborted."
        exit 1
    }
}

git commit -m "$commitMsg"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Git commit failed. Push aborted."
    exit 1
}

git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Error "Git push failed. Please verify remote origin settings and credentials."
    exit 1
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "  Safe Git push completed successfully!" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
exit 0
