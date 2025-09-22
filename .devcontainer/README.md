# VS Code Copilot Chat Development Container with Corporate Certificates

This enhanced devcontainer integrates corporate certificate management using the hybrid approach from the `certificate-management` project.

## 🚀 Quick Start

### Prerequisites
1. **Certificate Volume**: The corporate certificate volume must be initialized first
2. **Docker**: Docker Desktop or Docker Engine running
3. **VS Code**: With Dev Containers extension

### Setup Process

#### 1. Initialize Corporate Certificates
```bash
# Navigate to certificate-management project
cd ../certificate-management

# Windows (PowerShell as Administrator)
.\init-cert-volume.ps1

# Linux/macOS
./init-cert-volume.sh
```

#### 2. Open in VS Code
1. Open VS Code in the `vscode-copilot-chat` directory
2. When prompted, select "Reopen in Container"
3. Or use Command Palette: `Dev Containers: Reopen in Container`

## 🏗️ Architecture

### Certificate Integration
- **External Volume**: `corporate_certificates` volume contains corporate certificate bundle
- **Environment Variables**: Automatically configured for all HTTP libraries
- **System Integration**: Certificates installed to system CA store
- **Multi-language Support**: Works with Node.js, Python, cURL, and more

### Development Features
- **Node.js 22**: Latest LTS with TypeScript support
- **VS Code Extensions**: ESLint, Prettier, Copilot, etc. pre-installed
- **Docker-in-Docker**: Build and test containers within devcontainer
- **Azure CLI**: For cloud development
- **Python & .NET**: Additional runtime support
- **Performance Optimized**: Cached node_modules and VS Code extensions

### Hybrid Configuration
Following the certificate-management hybrid approach:
- **Docker Compose**: Service orchestration with certificate mounting
- **Environment Variables**: Comprehensive SSL/TLS configuration
- **Script Reuse**: Uses existing `setup-corporate-certs.sh` script
- **Validation**: Built-in certificate verification

## 📋 Available Commands

### Development
```bash
# Start development mode
npm run watch

# Run tests
npm run test:unit

# Clean and reinstall dependencies
npm-clean

# Test certificate connectivity
test-certs

# View copilot instructions and workflows
ls -la /copilot-instructions-and-workflows
cat /copilot-instructions-and-workflows/.github/copilot-instructions.md
```

### Certificate Management
```bash
# Test certificate setup
curl -s https://api.github.com

# View certificate info
openssl x509 -in /opt/corporate-certs/corporate-ca-bundle.pem -text -noout | head -20
```

## 🔧 Configuration

### Environment Variables
Automatically configured:
- `REQUESTS_CA_BUNDLE`: For Python requests
- `CURL_CA_BUNDLE`: For cURL
- `SSL_CERT_FILE`: Standard SSL certificate file
- `NODE_EXTRA_CA_CERTS`: For Node.js HTTPS
- `HTTPX_CA_BUNDLE`: For Python httpx

### Volume Mounts
- `/workspace`: Project source code
- `/copilot-instructions-and-workflows`: Copilot instructions and workflows (read-only)
- `/opt/corporate-certs`: Corporate certificates (read-only)
- `/home/node/.vscode-server`: VS Code extensions cache
- `/workspace/node_modules`: Cached dependencies

## 🧪 Testing

### Certificate Verification
The devcontainer includes built-in certificate testing:

```bash
# Automatic test on container start
/opt/setup-corporate-certs.sh

# Manual connectivity tests
curl -s https://api.github.com
node -e "const https = require('https'); https.get('https://api.github.com', res => console.log('✅ Node.js HTTPS working'));"
python3 -c "import requests; print('✅ Python requests working' if requests.get('https://api.github.com').status_code == 200 else '❌ Failed')"
```

### Development Environment
- TypeScript compilation: `npm run compile`
- Watch mode: `npm run watch`
- Unit tests: `npm run test:unit`
- Linting: `npm run lint`

## 🔍 Troubleshooting

### Certificate Issues
```bash
# Check if certificate volume exists
docker volume inspect corporate_certificates

# Verify certificate bundle
ls -la /opt/corporate-certs/
grep -c "BEGIN CERTIFICATE" /opt/corporate-certs/corporate-ca-bundle.pem
```

### Container Issues
```bash
# Rebuild container
docker-compose -f .devcontainer/docker-compose.yml build --no-cache

# Check logs
docker-compose -f .devcontainer/docker-compose.yml logs devcontainer
```

### VS Code Issues
1. **Rebuild Container**: Command Palette → `Dev Containers: Rebuild Container`
2. **Clear Cache**: Delete `.devcontainer` volumes and rebuild
3. **Extension Issues**: Check that extensions are properly installed

## 📁 File Structure

```
.devcontainer/
├── devcontainer.json          # VS Code devcontainer configuration
├── docker-compose.yml         # Service orchestration with certificates
├── Dockerfile                 # Enhanced container with certificate support
└── README.md                  # This documentation
```

## 🔄 Updates

### Certificate Updates
When corporate certificates change:
```bash
cd ../certificate-management
.\init-cert-volume.ps1  # Windows
./init-cert-volume.sh   # Linux
```
Then rebuild the devcontainer.

### Devcontainer Updates
The configuration inherits from the VS Code TypeScript-Node template and adds certificate management. Future updates should maintain compatibility with both systems.

## 🎯 Benefits

✅ **Zero SSL Errors**: All HTTPS requests work with corporate proxy/firewall
✅ **Seamless Development**: Same experience as local development
✅ **Multi-language Support**: Node.js, Python, .NET, Azure CLI all configured
✅ **Performance Optimized**: Cached dependencies and extensions
✅ **Enterprise Ready**: Corporate security compliance built-in
✅ **Hybrid Architecture**: Reuses existing certificate management patterns
