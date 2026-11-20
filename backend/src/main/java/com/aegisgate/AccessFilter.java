package com.aegisgate;

import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/** Defense in depth. Only the session manager can assert application roles. */
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AccessFilter implements ContainerRequestFilter {
    @ConfigProperty(name = "aegis.internal-token") String internalToken;
    @Override
    public void filter(ContainerRequestContext request) {
        String supplied = request.getHeaderString("x-aegis-internal");
        if (internalToken.length() < 32 || supplied == null || !MessageDigest.isEqual(
                internalToken.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))) {
            request.abortWith(Response.status(401).entity(java.util.Map.of("error", "Trusted session manager required")).build());
            return;
        }
        String raw = request.getHeaderString("x-aegis-roles");
        Set<String> roles = raw == null ? Set.of() : Arrays.stream(raw.split(",")).collect(Collectors.toSet());
        String path = request.getUriInfo().getPath();
        if (path.startsWith("/")) path = path.substring(1);
        Set<String> allowed = switch (request.getMethod() + " " + path) {
            case "GET api/projects", "GET api/overview" -> Set.of("viewer", "operator", "admin");
            case "POST api/deployments" -> Set.of("operator", "admin");
            case "GET api/admin" -> Set.of("admin");
            default -> Set.of();
        };
        if (roles.stream().noneMatch(allowed::contains)) {
            request.abortWith(Response.status(403).entity(java.util.Map.of("error", "Role denied")).build());
        }
    }
}
