# Development Workflow - VS Code Copilot Chat Enhanced Devcontainer

## Enhanced Devcontainer Setup (September 2025)

### Overview
The VS Code Copilot Chat project now includes an enhanced devcontainer setup with corporate certificate support, providing a complete enterprise development environment using Docker Compose orchestration.

### Key Features
- **Docker Compose Architecture**: Service-based container orchestration
- **Corporate Certificate Integration**: Automated setup with 226+ certificates
- **Volume Strategy**: Optimized mounts for workspace, certificates, and performance
- **Development Tools**: Node.js 22, TypeScript, Docker CLI, Azure CLI, .NET SDK
- **VS Code Integration**: Pre-configured extensions and development environment

### Quick Start
```bash
# Prerequisites: Docker Desktop, VS Code with Dev Containers extension
# Ensure corporate certificate volume exists (via certificate-management project)

# Clone and open in devcontainer
git clone <repository>
cd vscode-copilot-chat
code .
# VS Code will prompt to "Reopen in Container"
```

### Volume Architecture
1. **Workspace Mount**: `/workspace` → VS Code Copilot Chat source code
2. **Certificate Volume**: `/opt/corporate-certs` → External corporate certificate bundle
3. **Instructions Mount**: `/copilot-instructions-and-workflows` → Shared workflow documentation
4. **Performance Caches**: Node modules, VS Code server data for faster rebuilds

### Corporate Certificate Process
The devcontainer automatically handles corporate certificate integration:

1. **Certificate Detection**: Checks for certificates in `/opt/corporate-certs/`
2. **System Integration**: Copies certificates to system CA store
3. **Environment Variables**: Configures Node.js, Python, curl certificate paths
4. **Validation**: Tests HTTPS connectivity to verify certificate trust chain

### Development Workflow Integration
Following the established project workflow from copilot-instructions.md:

#### Build and Compile
- `npm ci` - Install dependencies (leverages Docker volume caching)
- `npm run compile` - TypeScript compilation with esbuild
- `npm run watch` - Development mode with file watching

#### Testing
- `npm run test:unit` - Unit tests (3473+ tests validated)
- `npm run test:extension` - VS Code integration tests (requires display)
- Test environment includes corporate certificate support for HTTPS requests

#### Development Aliases
Pre-configured aliases available in the devcontainer:
- `copilot-instructions` - View main project guidelines
- `workflow-help` - List available workflow documentation
- `test-certs` - Validate certificate connectivity
- `npm-clean` - Clean rebuild workflow

### Certificate Management Strategy
Implements hybrid approach from certificate-management project:

1. **External Volume**: `corporate_certificates` volume with consolidated bundle
2. **Runtime Setup**: Automated certificate installation during container startup  
3. **Environment Configuration**: Certificate paths for all development tools
4. **Graceful Fallback**: Continues without certificates if volume unavailable

### Troubleshooting

#### Container Build Issues
- Ensure Docker Desktop is running with adequate resources (4GB+ RAM)
- Corporate network: Some packages (Azure CLI, .NET SDK) install with graceful fallback
- Certificate errors: Verify corporate_certificates volume exists and is accessible

#### Permission Issues
- Node modules: Container automatically fixes ownership for npm operations
- File system: Windows/Docker volume mounts use root ownership (expected)

#### Certificate Problems
- Run certificate check: `docker-compose run certificate-check`
- Manual setup: Execute `/opt/setup-corporate-certs.sh` as root
- Validation: Test HTTPS connectivity with `curl -s https://api.github.com`

### Performance Optimizations
- **Volume Caching**: Node modules and VS Code server data persist across rebuilds
- **Layer Caching**: Docker build layers optimized for development workflow
- **Dependency Management**: npm ci with corporate certificate support

### Integration with Existing Workflow
This devcontainer enhancement follows the established development workflow:
- Maintains compatibility with existing build scripts and npm commands
- Preserves VS Code extension configuration and debugging setup
- Integrates with corporate infrastructure while supporting local development
- Supports both online and offline development scenarios

### File Structure Added
```
.devcontainer/
├── devcontainer.json     # VS Code devcontainer configuration
├── docker-compose.yml    # Service orchestration and volume mounts
├── Dockerfile           # Enhanced container with certificate support
└── README.md           # Setup and troubleshooting guide
```

This enhancement provides enterprise developers with a consistent, pre-configured development environment that automatically handles corporate infrastructure requirements while maintaining the flexibility and performance needed for VS Code Copilot Chat development.