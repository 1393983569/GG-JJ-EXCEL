FROM alpine:3.20

# 与本地开发用的版本保持一致
ARG PB_VERSION=0.40.6
# TARGETARCH 由 BuildKit 自动注入（amd64 / arm64），这里不要写默认值，
# 否则在 arm64 服务器上会下载到 amd64 的包，运行时报 exec format error
ARG TARGETARCH

RUN apk add --no-cache curl unzip ca-certificates tzdata \
 && curl -fsSL -o /tmp/pb.zip \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
 && unzip -q /tmp/pb.zip pocketbase -d /usr/local/bin \
 && rm /tmp/pb.zip

WORKDIR /pb
EXPOSE 4399

ENTRYPOINT ["pocketbase"]
CMD ["serve", "--http=0.0.0.0:4399"]
