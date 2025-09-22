# VS Code Copilot Chat Development Container with Corporate Certificate Support
# Based on existing devcontainer but enhanced with certificate management

ARG NODE_VERSION=22
FROM mcr.microsoft.com/devcontainers/typescript-node:1-${NODE_VERSION}

# Switch to root for system installations
USER root

# Install additional system dependencies for certificate management
RUN apt-get update && apt-get install -y \
    # Certificate management tools
    ca-certificates \
    openssl \
    curl \
    wget \
    # Development tools already in base image, but ensuring latest
    git-lfs \
    build-essential \
    # Python and pip (already in base via features, but ensuring consistency)
    python3 \
    python3-pip \
    # Azure CLI dependencies
    gnupg \
    lsb-release \
    software-properties-common \
    # Docker CLI for Docker-in-Docker
    apt-transport-https \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install Azure CLI (same as in original devcontainer features)
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash

# Install .NET SDK (same as in original devcontainer features)
RUN wget https://packages.microsoft.com/config/debian/$(lsb_release -rs)/packages-microsoft-prod.deb -O packages-microsoft-prod.deb \
    && dpkg -i packages-microsoft-prod.deb \
    && rm packages-microsoft-prod.deb \
    && apt-get update \
    && apt-get install -y dotnet-sdk-8.0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages commonly used in development
RUN pip3 install --no-cache-dir \
    requests \
    httpx \
    pytest \
    black \
    flake8 \
    certifi

# Copy corporate certificate setup script from certificate-management project
# This reuses the existing, tested script
COPY ../certificate-management/setup-corporate-certs.sh /opt/setup-corporate-certs.sh
RUN chmod +x /opt/setup-corporate-certs.sh

# Create corporate certificate directory with proper permissions
RUN mkdir -p /opt/corporate-certs && \
    chmod 755 /opt/corporate-certs

# Switch back to node user (maintaining original devcontainer user)
USER node

# Set working directory
WORKDIR /workspace

# Configure git LFS (same as original onCreateCommand)
RUN git lfs install --force

# Create directories for VS Code extensions
RUN mkdir -p /home/node/.vscode-server/extensions \
    && mkdir -p /home/node/.vscode-server-insiders/extensions

# Set default shell
ENV SHELL=/bin/bash

# Add certificate environment variables to user profile
RUN echo '# Corporate Certificate Environment Variables' >> /home/node/.bashrc && \
    echo 'export REQUESTS_CA_BUNDLE="/opt/corporate-certs/corporate-ca-bundle.pem"' >> /home/node/.bashrc && \
    echo 'export CURL_CA_BUNDLE="/opt/corporate-certs/corporate-ca-bundle.pem"' >> /home/node/.bashrc && \
    echo 'export SSL_CERT_FILE="/opt/corporate-certs/corporate-ca-bundle.pem"' >> /home/node/.bashrc && \
    echo 'export NODE_EXTRA_CA_CERTS="/opt/corporate-certs/corporate-ca-bundle.pem"' >> /home/node/.bashrc

# Development aliases for VS Code Copilot Chat
RUN echo '# VS Code Copilot Chat Development Aliases' >> /home/node/.bashrc && \
    echo 'alias npm-clean="rm -rf node_modules package-lock.json && npm install"' >> /home/node/.bashrc && \
    echo 'alias test-watch="npm run test:unit -- --watch"' >> /home/node/.bashrc && \
    echo 'alias build-watch="npm run watch"' >> /home/node/.bashrc && \
    echo 'alias test-certs="curl -s https://api.github.com && echo \"Certificate setup working!\""' >> /home/node/.bashrc && \
    echo 'alias copilot-instructions="cat /copilot-instructions-and-workflows/.github/copilot-instructions.md"' >> /home/node/.bashrc && \
    echo 'alias workflow-help="ls -la /copilot-instructions-and-workflows && echo \"Available in /copilot-instructions-and-workflows\""' >> /home/node/.bashrc

# Default command (will be overridden by docker-compose)
CMD ["/bin/bash"]