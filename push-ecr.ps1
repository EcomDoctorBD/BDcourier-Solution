# ==============================================================================
# Amazon ECR Image Build & Push Automation
# Project: Delivery1 (ECS Fargate in ap-southeast-2)
# ==============================================================================

$AwsAccountId = "496663582013"
$AwsRegion = "ap-southeast-2"
$EcrRepo = "delivery1-courier-app"
$EcrUri = "$AwsAccountId.dkr.ecr.$AwsRegion.amazonaws.com/$EcrRepo"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 Building & Pushing Delivery1 to Amazon ECR (ECS)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Login to Amazon ECR
Write-Host "`n[1/4] Authenticating with Amazon ECR..." -ForegroundColor Green
$env:Path = "C:\Users\LENOVO\AppData\Local\Programs\Amazon\AWSCLIV2;C:\Users\LENOVO\.local\bin;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
aws ecr get-login-password --region $AwsRegion --profile delivery1 | docker login --username AWS --password-stdin "$AwsAccountId.dkr.ecr.$AwsRegion.amazonaws.com"

# 2. Build Docker Container
Write-Host "`n[2/4] Building production Docker container..." -ForegroundColor Green
docker build -t "$EcrUri`:latest" .

# 3. Push to ECR
Write-Host "`n[3/4] Pushing image to ECR ($EcrUri:latest)..." -ForegroundColor Green
docker push "$EcrUri`:latest"

# 4. Trigger ECS Service Deployment
Write-Host "`n[4/4] Updating ECS Fargate service to run latest image..." -ForegroundColor Green
aws ecs update-service --cluster delivery1-cluster --service delivery1-service --force-new-deployment --region $AwsRegion --profile delivery1

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " ✅ DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host " 🌐 Application URL: http://delivery1-alb-1581793960.ap-southeast-2.elb.amazonaws.com" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
