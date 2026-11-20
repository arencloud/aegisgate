package com.aegisgate;

import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Path("/api")
@Produces(MediaType.APPLICATION_JSON)
public class ApplicationResource {
    @GET @Path("overview")
    public Map<String, Object> overview() {
        return Map.of("application", "AegisGate", "backend", "Quarkus", "time", Instant.now().toString(),
            "mode", System.getenv().getOrDefault("DEPLOYMENT_MODE", "local"),
            "message", "Authenticated request reached the protected application");
    }
    @GET @Path("projects")
    public List<Map<String, String>> projects() {
        // Sample business data, not cluster telemetry.
        return List.of(
            Map.of("id", "payments", "name", "Payments API", "description", "Transaction processing and settlement", "category", "Financial services", "owner", "Platform team"),
            Map.of("id", "customer", "name", "Customer portal", "description", "A secure home for customer experiences", "category", "Customer experience", "owner", "Experience team"),
            Map.of("id", "analytics", "name", "Analytics workspace", "description", "Operational insights and reporting", "category", "Data platform", "owner", "Data team")
        );
    }
    public record DeploymentRequest(String project) {}
    @POST @Path("deployments") @Consumes(MediaType.APPLICATION_JSON)
    public Response deploy(DeploymentRequest request) {
        if (request == null || request.project() == null || !List.of("payments", "customer", "analytics").contains(request.project())) {
            return Response.status(400).entity(Map.of("error", "Choose a known project")).build();
        }
        return Response.ok(Map.of("id", UUID.randomUUID().toString(), "project", request.project(),
            "status", "demo-action-accepted", "message", "RBAC check passed. This demo action does not deploy a workload.")).build();
    }
    @GET @Path("admin")
    public Map<String, String> admin() {
        return Map.of("message", "Administrator access verified", "enforcement", "Rust RBAC + Quarkus defense in depth");
    }
}
