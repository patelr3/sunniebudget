FROM docker.io/actualbudget/actual-server:latest

USER root
RUN apt-get update && apt-get install -y rsync && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy entrypoint wrapper
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER actual
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/entrypoint.sh"]
