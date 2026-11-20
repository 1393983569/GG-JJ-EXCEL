FROM alpine:3.20

# 与本地开发用的版本保持一致
ARG PB_VERSION=0.40.6
ARG TARGETARCH=amd64

RUN apk add --no-cache curl unzip ca-certificates tzdata \
 && curl -fsSL -o /tmp/pb.zip \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
 && unzip -q /tmp/pb.zip pocketbase -d /usr/local/bin \
 && rm /tmp/pb.zip

WORKDIR /pb
EXPOSE 4399

ENTRYPOINT ["pocketbase"]
CMD ["serve", "--http=0.0.0.0:4399"]
