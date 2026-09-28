const fs = require("fs");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

async function importParcels() {
    const client = await pool.connect();

    try {
        const filePath = "./land_parcels_229.geojson";

        console.log("Reading GeoJSON file...");

        const geojson = JSON.parse(
            fs.readFileSync(filePath, "utf8")
        );

        console.log(
            `Found ${geojson.features.length} parcel features.`
        );

        await client.query("BEGIN");

        for (let i = 0; i < geojson.features.length; i++) {

            const feature = geojson.features[i];

            const properties = feature.properties || {};
            const geometry = feature.geometry;

            if (!geometry) {
                console.log(
                    `Skipping feature ${i + 1}: geometry is missing`
                );
                continue;
            }

            // Unique LandStack parcel number
            // 1 -> GIS-0001
            // 2 -> GIS-0002
            // ...
            // 229 -> GIS-0229
            const featureNumber = i + 1;

            const parcelId =
                `GIS-${String(featureNumber).padStart(4, "0")}`;

            // Original GIS Id from the shapefile/GeoJSON.
            // This value can contain duplicates, so it is NOT used
            // as the unique parcel ID.
            const gisId =
                properties.Id !== undefined
                    ? properties.Id
                    : null;

            // Original LP number
            const lpNumber =
                properties.Lp_number !== undefined
                    ? properties.Lp_number
                    : null;

            // Use LP number as survey number when available.
            // For LP = 0 or missing, use the unique GIS parcel ID.
            const surveyNumber =
                lpNumber !== null && lpNumber !== 0
                    ? String(lpNumber)
                    : parcelId;

            // Insert parcel information
            const parcelResult = await client.query(
                `
                INSERT INTO land_parcels
                (
                    parcel_id,
                    survey_number,
                    village,
                    district,
                    gis_id,
                    lp_number
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6
                )
                RETURNING id
                `,
                [
                    parcelId,
                    surveyNumber,
                    "Demo Village",
                    "Demo District",
                    gisId,
                    lpNumber
                ]
            );

            const databaseParcelId =
                parcelResult.rows[0].id;

            // Insert geometry.
            // ST_Multi converts Polygon -> MultiPolygon
            // and keeps MultiPolygon as MultiPolygon.
            await client.query(
                `
                INSERT INTO parcel_geometry
                (
                    parcel_id,
                    geom
                )
                VALUES
                (
                    $1,
                    ST_Multi(
                        ST_GeomFromGeoJSON($2)
                    )
                )
                `,
                [
                    databaseParcelId,
                    JSON.stringify(geometry)
                ]
            );

            console.log(
                `Imported ${featureNumber}/${geojson.features.length} | ` +
                `Parcel: ${parcelId} | ` +
                `Source Id: ${gisId} | ` +
                `LP: ${lpNumber}`
            );
        }

        await client.query("COMMIT");

        console.log("");
        console.log("======================================");
        console.log("SUCCESS");
        console.log(
            `Imported ${geojson.features.length} parcel features.`
        );
        console.log("======================================");

    } catch (error) {

        console.error("");
        console.error("IMPORT ERROR:");
        console.error(error.message);

        try {
            await client.query("ROLLBACK");
            console.log("Transaction rolled back.");
        } catch (rollbackError) {
            console.error(
                "Rollback error:",
                rollbackError.message
            );
        }

    } finally {

        client.release();
        await pool.end();
    }
}

importParcels();