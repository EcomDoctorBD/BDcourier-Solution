# ==============================================================================
# AWS App Runner & ECR Automated Production Deployment Script
# Bangladeshi Courier Automation Shopify App (Delivery1)
# ==============================================================================

param(
    [string]$AwsRegion = "ap-southeast-1",
    [string]$ServiceName = "bd-courier-shopify-app",
    [string]$EcrRepoName = "bd-courier-shopify-app",
    [string]$DatabaseUrl = $env:DATABASE_URL,
    [string]$ShopifyApiKey = $env:SHOPIFY_API_KEY,
    [string]$ShopifyApiSecret = $env:SHOPIFY_API_SECRET,
    [string]$Scopes = "write_products,read_orders,write_orders,read_fulfillments,write_fulfillments,read_shipping,write_shipping",
    [string]$GeminiApiKey = $env:GEMINI_API_KEY,
    [string]$GeminiModel = "gemini-1.5-flash"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 Bangladeshi Courier Automation - AWS Deployment Engine" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verify Prerequisites
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Host "❌ AWS CLI is not installed or not in PATH." -ForegroundColor Red
    Write-Host "   Install AWS CLI from: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    Write-Host "   Or deploy using AWS CloudFormation / GitHub Actions provided in this repo." -ForegroundColor Yellow
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Docker is not installed or not running." -ForegroundColor Red
    Write-Host "   Install Docker Desktop or push directly to AWS App Runner via GitHub repo connection." -ForegroundColor Yellow
    exit 1
}

# 2. Check AWS Identity
Write-Host "`n[1/6] Verifying AWS Identity and Credentials..." -ForegroundColor Green
$identity = aws sts get-caller-identity | ConvertFrom-Json
if (-not $identity) {
    Write-Host "❌ Failed to authenticate with AWS. Please run 'aws configure'." -ForegroundColor Red
    exit 1
}
$awsAccountId = $identity.Account
Write-Host "  ✅ Connected as Account: $awsAccountId (Region: $AwsRegion)" -ForegroundColor Gray

# 3. Compile Production Assets
Write-Host "`n[2/6] Compiling React Router 7 / Vite Production Bundle..." -ForegroundColor Green
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Production build failed. Aborting deployment." -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ Build succeeded (0 errors)." -ForegroundColor Gray

# 4. Create/Verify Amazon ECR Repository
Write-Host "`n[3/6] Ensuring Amazon ECR Repository exists ($EcrRepoName)..." -ForegroundColor Green
$ecrRepo = aws ecr describe-repositories --repository-names $EcrRepoName --region $AwsRegion 2>$null | ConvertFrom-Json
if (-not $ecrRepo) {
    Write-Host "  Creating new ECR repository: $EcrRepoName..." -ForegroundColor Yellow
    aws ecr create-repository --repository-name $EcrRepoName --image-scanning-configuration scanOnPush=true --region $AwsRegion | Out-Null
}
$ecrUri = "$awsAccountId.dkr.ecr.$AwsRegion.amazonaws.com/$EcrRepoName"
Write-Host "  ✅ ECR Target: $ecrUri:latest" -ForegroundColor Gray

# 5. Build and Push Docker Image
Write-Host "`n[4/6] Building and Pushing Production Docker Container..." -ForegroundColor Green
aws ecr get-login-password --region $AwsRegion | docker login --username AWS --password-stdin "$awsAccountId.dkr.ecr.$AwsRegion.amazonaws.com"
docker build -t "$ecrUri`:latest" .
docker push "$ecrUri`:latest"
Write-Host "  ✅ Container pushed to ECR successfully." -ForegroundColor Gray

# 6. Setup App Runner Access Role
Write-Host "`n[5/6] Verifying IAM ECR Access Role for App Runner..." -ForegroundColor Green
$roleName = "AppRunnerECRAccessRole"
$assumeRoleDoc = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam create-role --role-name $roleName --assume-role-policy-document $assumeRoleDoc 2>$null | Out-Null
aws iam attach-role-policy --role-name $roleName --policy-arn "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess" 2>$null | Out-Null
$accessRoleArn = "arn:aws:iam::$awsAccountId`:role/$roleName"

# 7. Create or Update AWS App Runner Service
Write-Host "`n[6/6] Launching AWS App Runner Service ($ServiceName)..." -ForegroundColor Green
$existingService = aws apprunner list-services --region $AwsRegion | ConvertFrom-Json | Select-Object -ExpandProperty ServiceSummaryList | Where-Object { $_.ServiceName -eq $ServiceName }

if ($existingService) {
    Write-Host "  Existing service found. Triggering redeployment..." -ForegroundColor Yellow
    aws apprunner start-deployment --service-arn $existingService.ServiceArn --region $AwsRegion | Out-Null
    $appRunnerUrl = "https://" + $existingService.ServiceUrl
} else {
    Write-Host "  Creating new App Runner service..." -ForegroundColor Yellow
    $sourceConfig = @"
{
    "AuthenticationConfiguration": {
        "AccessRoleArn": "$accessRoleArn"
    },
    "ImageRepository": {
        "ImageIdentifier": "$ecrUri:latest",
        "ImageConfiguration": {
            "Port": "3000",
            "RuntimeEnvironmentVariables": {
                "NODE_ENV": "production",
                "HOST": "0.0.0.0",
                "PORT": "3000",
                "DATABASE_URL": "$DatabaseUrl",
                "SHOPIFY_API_KEY": "$ShopifyApiKey",
                "SHOPIFY_API_SECRET": "$ShopifyApiSecret",
                "SCOPES": "$Scopes",
                "GEMINI_API_KEY": "$GeminiApiKey",
                "GEMINI_MODEL": "$GeminiModel"
            }
        },
        "ImageRepositoryType": "ECR"
    },
    "AutoDeploymentsEnabled": true
}
"@
    $created = aws apprunner create-service `
        --service-name $ServiceName `
        --source-configuration $sourceConfig `
        --instance-configuration '{"Cpu":"1 vCPU","Memory":"2 GB"}' `
        --health-check-configuration '{"Protocol":"HTTP","Path":"/api/shipping-rates","Interval":10,"Timeout":5,"HealthyThreshold":1,"UnhealthyThreshold":3}' `
        --region $AwsRegion | ConvertFrom-Json

    $appRunnerUrl = "https://" + $created.Service.ServiceUrl
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " 🎉 AWS APP RUNNER DEPLOYMENT INITIALIZED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " 🌐 Production App URL: $appRunnerUrl" -ForegroundColor Cyan
Write-Host " 🔍 Healthcheck URL:   $appRunnerUrl/api/shipping-rates" -ForegroundColor Cyan
Write-Host " 📋 Update Shopify Partner Dashboard:" -ForegroundColor Yellow
Write-Host "    - App URL: $appRunnerUrl" -ForegroundColor Yellow
Write-Host "    - Allowed redirection URL(s): $appRunnerUrl/api/auth" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green
