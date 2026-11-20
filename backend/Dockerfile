FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /work
COPY pom.xml .
COPY src src
RUN mvn -B verify
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /work/target/quarkus-app/ ./
USER 1001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "quarkus-run.jar"]
