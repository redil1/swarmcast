ARG ALPINE_IMAGE=alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40

FROM ${ALPINE_IMAGE} AS prometheus-build
RUN apk add --no-cache ca-certificates cmake g++ git libmicrohttpd-dev make
ARG PROMETHEUS_CLIENT_COMMIT=23b260f0916ef9ea03cac91d3d64a93cd33ea563
WORKDIR /src/prometheus-client-c
RUN git init \
    && git remote add origin https://github.com/digitalocean/prometheus-client-c.git \
    && git fetch --depth=1 origin "${PROMETHEUS_CLIENT_COMMIT}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${PROMETHEUS_CLIENT_COMMIT}" \
    && cmake -S prom -B prom/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/usr \
      -DCMAKE_SKIP_BUILD_RPATH=TRUE \
      -DTEST=OFF \
    && cmake --build prom/build --parallel \
    && mkdir -p /out/usr/lib /out/usr/include \
    && cp prom/build/libprom.so /out/usr/lib/ \
    && cp -R prom/include/. /out/usr/include/

FROM ${ALPINE_IMAGE} AS coturn-build
RUN apk add --no-cache \
      ca-certificates g++ git libevent-dev libmicrohttpd-dev linux-headers make openssl-dev
COPY --from=prometheus-build /out/ /
ARG COTURN_COMMIT=678996a52954ddc7a44afd9f72f5b5c647e41083
WORKDIR /src/coturn
RUN git init \
    && git remote add origin https://github.com/coturn/coturn.git \
    && git fetch --depth=1 origin "${COTURN_COMMIT}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${COTURN_COMMIT}"
RUN TURN_NO_SQLITE=1 \
    TURN_NO_PQ=1 \
    TURN_NO_MYSQL=1 \
    TURN_NO_MONGO=1 \
    TURN_NO_HIREDIS=1 \
    TURN_NO_SYSTEMD=1 \
    ./configure \
      --prefix=/usr \
      --turndbdir=/var/lib/coturn \
      --disable-rpath \
      --sysconfdir=/etc/coturn \
      --mandir=/tmp/coturn/man \
      --docsdir=/tmp/coturn/docs \
      --examplesdir=/tmp/coturn/examples \
    && make -j"$(getconf _NPROCESSORS_ONLN)" \
    && mkdir -p /out \
    && DESTDIR=/out make install \
    && rm -rf /out/tmp /out/etc/coturn/turnserver.conf.default
COPY --from=prometheus-build /out/ /out/

FROM ${ALPINE_IMAGE}
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates libcrypto3 libevent libmicrohttpd libssl3
COPY --from=coturn-build /out/ /
RUN mkdir -p /var/lib/coturn \
    && chown -R nobody:nogroup /var/lib/coturn
USER nobody:nogroup
EXPOSE 3478/tcp 3478/udp 5349/tcp 5349/udp
ENTRYPOINT ["/usr/bin/turnserver"]
CMD ["--log-file=stdout"]
