ALTER TABLE "Environment" ADD COLUMN "acceptedControlPlaneDeploymentId" TEXT;
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_acceptedControlPlaneDeploymentId_fkey" FOREIGN KEY ("acceptedControlPlaneDeploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD COLUMN "controlPlaneSnapshot" JSONB;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_control_plane_snapshot" CHECK (("kind" = 'upgrade-control-plane') = ("controlPlaneSnapshot" IS NOT NULL));
ALTER TABLE "PlatformArtifactReference" DROP CONSTRAINT "PlatformArtifactReference_kind_check";
ALTER TABLE "PlatformArtifactReference" ADD CONSTRAINT "PlatformArtifactReference_kind_check" CHECK ("kind" IN ('root-chart', 'site-prerequisite', 'control-plane-previous', 'control-plane-next', 'control-plane-chart'));
