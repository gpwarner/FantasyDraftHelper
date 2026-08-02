# Container deployment

The image is designed to run as a single Linux `amd64` Kubernetes
workload. It does not listen on a network port; it connects outbound to
Discord and Warcraft Logs.

## Build and publish

Replace the example image name with the registry and repository chosen
for the cluster:

```sh
docker buildx build --platform linux/amd64 -t registry.example/rgrecruitment:VERSION --load .
docker push registry.example/rgrecruitment:VERSION
```

When building directly on an x86 Linux host, an ordinary `docker build`
also produces an `amd64` image.

If the image needs to be transferred as an OCI archive instead of
through a registry:

```sh
docker buildx build --platform linux/amd64 --output type=oci,dest=rgrecruitment.oci.tar .
```

## Required environment variables

Provide these through a Kubernetes Secret or equivalent runtime
configuration. Do not add a `.env` file to the image.

- `DISCORD_TOKEN`
- `AZERITE_CHANNEL_ID`
- `OUTPUT_CHANNEL_ID`
- `AUDIT_CHANNEL_ID`
- `AZERITE_BOT_ID`
- `RECRUITMENT_OFFICER_IDS`
- `WCL_V2_CLIENT_ID`
- `WCL_V2_CLIENT_SECRET`

## Persistent state

Mount persistent writable storage at `/app/data`. The recruitment case
state is stored at `/app/data/officer-thread-state.json` and must survive
pod replacement.

The image runs as the Node image's non-root `node` user (UID/GID 1000).
The Kubernetes pod can use an equivalent security context:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
```

To preserve existing workflows during the initial migration, stop the
Windows bot and copy the current `data/officer-thread-state.json` into
the persistent volume before starting the Kubernetes workload.

## Kubernetes behavior

- Run exactly one replica. Multiple instances can process the same feed
  events and concurrently modify the JSON state file.
- Use a `Recreate` deployment strategy so an update cannot temporarily
  run an old and new pod together.
- Do not run the Windows tray bot at the same time as the Kubernetes bot.
- No Service, Ingress, or container port is required.
- Container output goes to stdout/stderr and is available through the
  cluster's normal pod logging.

A minimal workload should therefore include `replicas: 1`,
`strategy.type: Recreate`, the Secret-provided environment variables,
and a persistent volume mounted at `/app/data`.
