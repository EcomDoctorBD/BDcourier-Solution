#!/usr/bin/env bash
# ==============================================================================
# AWS App Runner & ECR Automated Production Deployment Script
# Bangladeshi Courier Automation Shopify App (Delivery1)
# ==============================================================================

set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-southeast-1}"
SERVICE_NAME="${SERVICE_NAME:-bd-courier-shopify-app}"
ECR_REPO_NAME="${ECR_REPO_NAME:-bd-courier-shopify-app}"
DATABASE_URL="${DATABASE_URL:-}"
SHOPIFY_API_KEY="${SHOPIFY_API_KEY:-}"
SHOPIFY_API_SECRET="${SHOPIFY_API_SECRET:-}"
SCOPES="${SCOPES:-write_products,read_orders,write_orders,read_fulfillments,write_fulfillments,read_shipping,write_shipping}"

echo "=========================================================="
echo " 🚀 Bangladeshi Courier Automation - AWS Deployment Engine"
echo "=========================================================="

# 1. Prerequisites Check
if ! command -v aws &> /dev/null; then
  echo "❌ AWS CLI is not installed. Please install it: https://aws.amazon.com/cli/"
  exit 1
fi

if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed. Please install Docker or use AWS App Runner with GitHub connection."
  exit 1
fi

# 2. AWS Identity Verification
echo -e "\n[1/6] Verifying AWS credentials..."
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
echo "  ✅ Connected as Account: ${ACCOUNT_ID} (Region: ${AWS_REGION})"

# 3. Compile Production Bundle
echo -e "\n[2/6] Compiling production bundle..."
npm run build
echo "  ✅ Production build completed with 0 errors."

# 4. Amazon ECR Repository Setup
echo -e "\n[3/6] Setting up Amazon ECR Repository (${ECR_REPO_NAME})..."
aws ecr describe-repositories --repository-names "${ECR_REPO_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name "${ECR_REPO_NAME}" --image-scanning-configuration scanOnPush=true --region "${AWS_REGION}"

ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"
echo "  ✅ ECR Target: ${ECR_URI}:latest"

# 5. Build and Push Container Image
echo -e "\n[4/6] Building and pushing Docker container image..."
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
docker build -t "${ECR_URI}:latest" .
docker push "${ECR_URI}:latest"
echo "  ✅ Container pushed to ECR successfully."

# 6. Setup App Runner Access Role
echo -e "\n[5/6] Verifying IAM ECR Access Role for App Runner..."
ROLE_NAME="AppRunnerECRAccessRole"
ASSUME_ROLE_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam create-role --role-name "${ROLE_NAME}" --assume-role-policy-document "${ASSUME_ROLE_POLICY}" 2>/dev/null || true
aws iam attach-role-policy --role-name "${ROLE_NAME}" --policy-arn "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess" 2>/dev/null || true
ACCESS_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

# 7. Create or Update AWS App Runner Service
echo -e "\n[6/6] Launching AWS App Runner Service (${SERVICE_NAME})..."
EXISTING_SERVICE_ARN=$(aws apprunner list-services --region "${AWS_REGION}" --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn" --output text)

if [ -n "${EXISTING_SERVICE_ARN}" ] && [ "${EXISTING_SERVICE_ARN}" != "None" ]; then
  echo "  Existing service found. Triggering redeployment..."
  aws apprunner start-deployment --service-arn "${EXISTING_SERVICE_ARN}" --region "${AWS_REGION}" >/dev/null
  SERVICE_URL=$(aws apprunner describe-service --service-arn "${EXISTING_SERVICE_ARN}" --region "${AWS_REGION}" --query "Service.ServiceUrl" --output text)
  APP_RUNNER_URL="https://${SERVICE_URL}"
else
  echo "  Creating new App Runner service..."
  SOURCE_CONFIG=$(cat <<EOF
{
    "AuthenticationConfiguration": {
        "AccessRoleArn": "${ACCESS_ROLE_ARN}"
    },
    "ImageRepository": {
        "ImageIdentifier": "${ECR_URI}:latest",
        "ImageConfiguration": {
            "Port": "3000",
            "RuntimeEnvironmentVariables": {
                "NODE_ENV": "production",
                "HOST": "0.0.0.0",
                "PORT": "3000",
                "DATABASE_URL": "${DATABASE_URL}",
                "SHOPIFY_API_KEY": "${SHOPIFY_API_KEY}",
                "SHOPIFY_API_SECRET": "${SHOPIFY_API_SECRET}",
                "SCOPES": "${SCOPES}",
                "GEMINI_API_KEY": "${GEMINI_API_KEY}",
                "GEMINI_MODEL": "${GEMINI_MODEL:-gemini-1.5-flash}"
            }
        },
        "ImageRepositoryType": "ECR"
    },
    "AutoDeploymentsEnabled": true
}
EOF
)
  CREATED_JSON=$(aws apprunner create-service \
    --service-name "${SERVICE_NAME}" \
    --source-configuration "${SOURCE_CONFIG}" \
    --instance-configuration '{"Cpu":"1 vCPU","Memory":"2 GB"}' \
    --health-check-configuration '{"Protocol":"HTTP","Path":"/api/shipping-rates","Interval":10,"Timeout":5,"HealthyThreshold":1,"UnhealthyThreshold":3}' \
    --region "${AWS_REGION}")
  SERVICE_URL=$(echo "${CREATED_JSON}" | grep -o '"ServiceUrl": "[^"]*' | cut -d'"' -f4)
  APP_RUNNER_URL="https://${SERVICE_URL}"
fi

echo "=========================================================="
echo " 🎉 AWS APP RUNNER DEPLOYMENT INITIALIZED SUCCESSFULLY!"
echo "=========================================================="
echo " 🌐 Production App URL: ${APP_RUNNER_URL}"
echo " 🔍 Healthcheck URL:   ${APP_RUNNER_URL}/api/shipping-rates"
echo " 📋 Update Shopify Partner Dashboard:"
echo "    - App URL: ${APP_RUNNER_URL}"
echo "    - Allowed redirection URL(s): ${APP_RUNNER_URL}/api/auth"
echo "=========================================================="
