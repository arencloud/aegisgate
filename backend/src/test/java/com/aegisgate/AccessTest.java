package com.aegisgate;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

@QuarkusTest
class AccessTest {
    static final String TOKEN = "test-only-token-with-at-least-32-characters";
    @Test void rejectsForgedIdentityWithoutInternalCredential() {
        given().header("x-aegis-roles", "admin").when().get("/api/admin").then().statusCode(401);
    }
    @Test void readerCanReadButCannotAct() {
        given().header("x-aegis-internal", TOKEN).header("x-aegis-roles", "viewer").get("/api/projects").then().statusCode(200);
        given().header("x-aegis-internal", TOKEN).header("x-aegis-roles", "viewer").contentType("application/json").body("{\"project\":\"payments\"}").post("/api/deployments").then().statusCode(403);
    }
    @Test void operatorCanActButCannotAdminister() {
        given().header("x-aegis-internal", TOKEN).header("x-aegis-roles", "operator").contentType("application/json").body("{\"project\":\"payments\"}").post("/api/deployments").then().statusCode(200).body("status", equalTo("demo-action-accepted"));
        given().header("x-aegis-internal", TOKEN).header("x-aegis-roles", "operator").get("/api/admin").then().statusCode(403);
    }
    @Test void administratorCanAccessAdminEndpoint() {
        given().header("x-aegis-internal", TOKEN).header("x-aegis-roles", "admin").get("/api/admin").then().statusCode(200);
    }
}
