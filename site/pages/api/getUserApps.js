import Airtable from "airtable";

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID,
);

// Validation regex patterns
const tokenRegex = /^[A-Za-z0-9_-]{10,}$/;
const urlRegex =
  /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ message: "Missing token" });
  }

  // Validate token format
  if (!tokenRegex.test(token)) {
    return res.status(400).json({ message: "Invalid token format" });
  }

  try {
    console.log("Fetching user records with token");
    // Escape single quotes in token to prevent formula injection
    const safeToken = token.replace(/'/g, "\\'");
    const userRecords = await base(process.env.AIRTABLE_TABLE_ID)
      .select({
        filterByFormula: `{token} = '${safeToken}'`,
        maxRecords: 1,
      })
      .firstPage();

    if (userRecords.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const userId = userRecords[0].id;
    console.log("Found user with ID:", userId);

    // First, let's get ALL apps and then filter on our side
    // This way we can see what's in the database and debug the issue
    console.log("Fetching all apps to verify content");
    const allApps = await base("Apps")
      .select({
        fields: [
          "Name",
          "Icon",
          "createdAt",
          "Neighbors",
          "App Link",
          "Github Link",
          "Description",
          "Images",
          "isHacktendo",
        ],
      })
      .all();

    console.log(`Found ${allApps.length} total apps in the database`);

    // Log some sample apps to understand the data structure
    allApps.slice(0, 3).forEach((app, index) => {
      const iconInfo = app.fields.Icon
        ? `Icon present (${Array.isArray(app.fields.Icon) ? "Array" : typeof app.fields.Icon})`
        : "No icon";

      console.log(
        `Sample App ${index + 1}: ${app.id}, Name: ${app.fields.Name || "Unnamed"}, ${iconInfo}, Neighbors:`,
        app.fields.Neighbors,
      );
    });

    // Try a different filtering approach - client-side filtering
    const userApps = allApps.filter((app) => {
      const neighbors = app.fields.Neighbors || [];

      // Check different formats of the user ID in the array
      const hasUser = neighbors.includes(userId);

      // If we find the user, log it
      if (hasUser) {
        console.log(
          `Found app ${app.fields.Name} with user in neighbors:`,
          neighbors,
        );
      }

      return hasUser;
    });

    console.log(
      `Found ${userApps.length} apps for user after client-side filtering`,
    );

    // If we didn't find any matching apps, also log apps with no neighbors
    if (userApps.length === 0) {
      const appsWithoutNeighbors = allApps.filter(
        (app) => !app.fields.Neighbors || app.fields.Neighbors.length === 0,
      );
      console.log(
        `There are ${appsWithoutNeighbors.length} apps with no neighbors defined`,
      );

      // Log these apps as they might be the ones we're looking for
      appsWithoutNeighbors.forEach((app, index) => {
        console.log(
          `App without neighbors ${index + 1}: ${app.id}, Name: ${app.fields.Name || "Unnamed"}`,
        );
      });
    }

    // Format the apps data with correct icon handling
    const apps = userApps.map((app) => {
      // Handle both string URLs and Airtable attachment format for icons
      let iconUrl = null;
      if (app.fields.Icon) {
        if (typeof app.fields.Icon === "string") {
          // Direct URL string - validate URL format
          iconUrl = urlRegex.test(app.fields.Icon) ? app.fields.Icon : null;
        } else if (
          Array.isArray(app.fields.Icon) &&
          app.fields.Icon.length > 0
        ) {
          // Attachment array
          iconUrl = app.fields.Icon[0].url;
        }
      }

      // Handle Images field similar to Icon
      let images = [];
      if (app.fields.Images) {
        if (typeof app.fields.Images === "string") {
          // Single URL string - validate URL format
          if (urlRegex.test(app.fields.Images)) {
            images = [app.fields.Images];
          }
        } else if (Array.isArray(app.fields.Images)) {
          // Array of attachments - limit to 10 images to prevent excessive data
          const limitedImages = app.fields.Images.slice(0, 10);
          images = limitedImages.map((img) => img.url);
        }
      }

      return {
        id: app.id,
        name: app.fields.Name || "Unnamed App",
        icon: iconUrl,
        appLink: urlRegex.test(app.fields["App Link"])
          ? app.fields["App Link"]
          : "",
        githubLink: urlRegex.test(app.fields["Github Link"])
          ? app.fields["Github Link"]
          : "",
        description: app.fields.Description
          ? app.fields.Description.substring(0, 1000)
          : "",
        createdAt: app.fields.createdAt || null,
        Images: images,
        isHacktendo: app.fields.isHacktendo,
      };
    });

    return res.status(200).json({ apps });
  } catch (error) {
    console.error("Error fetching apps:", error);
    console.error("Detailed error information:", {
      message: error.message,
      stack: error.stack,
      statusCode: error.statusCode,
    });
    // Don't expose detailed error messages to client
    return res.status(500).json({ message: "Error fetching apps" });
  }
}
