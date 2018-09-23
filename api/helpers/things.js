let { isString } = require("lodash");
let log = require("winston");
const cache = require("apicache");
const equals = require("deep-equal");
const moment = require("moment");

const { as, db, sql } = require("./db");

const THING_BY_ID = sql(`../sql/thing_by_id.sql`);
const INSERT_LOCALIZED_TEXT = sql("../sql/insert_localized_text.sql");
const UPDATE_NOUN = sql("../sql/update_noun.sql");
const INSERT_AUTHOR = sql("../sql/insert_author.sql");

// Define the keys we're testing (move these to helper/things.js ?
const titleKeys = ["id", "title"];
const shortKeys = titleKeys.concat([
  "type",
  "images",
  "post_date",
  "updated_date"
]);
const mediumKeys = shortKeys.concat(["body", "bookmarked", "location"]);
const thingKeys = mediumKeys.concat([
  "description",
  "original_language",
  "published",
  "files",
  "videos",
  "featured",
  "tags",
  "url"
]);
const caseKeys = [
  "id",
  "type",
  "hidden",
  "post_date",
  "published",
  "updated_date",
  "featured",
  "original_language",
  "content_country",
  "title",
  "description",
  "body",
  "links",
  "tags",
  "location_name",
  "address1",
  "address2",
  "city",
  "province",
  "postal_code",
  "country",
  "latitude",
  "longitude",
  "relationships",
  "issues",
  "special_topics",
  "is_component_of",
  "scope_of_influence",
  "images",
  "videos",
  "files",
  "start_date",
  "end_date",
  "ongoing",
  "time_limited",
  "purpose",
  "approaches",
  "public_spectrum",
  "number_of_participants",
  "open_limited",
  "recruitment_method",
  "targeted_participants",
  "process_methods",
  "legality",
  "facilitators",
  "facilitator_training",
  "facetoface_online_or_both",
  "participants_interactions",
  "learning_resources",
  "decision_methods",
  "if_voting",
  "insights_outcomes",
  "primary_organizers",
  "organizer_types",
  "funder",
  "funder_types",
  "staff",
  "volunteers",
  "impact_evidence",
  "change_types",
  "implementers_of_change",
  "formal_evaluations",
  "evaluation_reports",
  "evaluation_links"
];
const methodKeys = [
  "id",
  "type",
  "hidden",
  "post_date",
  "published",
  "updated_date",
  "featured",
  "original_language",
  "content_country",
  "title",
  "description",
  "body",
  "links",
  "tags",
  "completeness",
  "facilitated",
  "geographical_scope",
  "participants_selections",
  "recruitment_method",
  "communication_modes",
  "communication_outcomes",
  "decision_methods",
  "if_voting",
  "public_interaction_methods",
  "issue_polarization",
  "issue_technical_complexity",
  "issue_interdependency",
  "typical_purposes",
  "communication_outcomes"
];
const organizationKeys = [
  "id",
  "type",
  "hidden",
  "post_date",
  "published",
  "updated_date",
  "featured",
  "original_language",
  "content_country",
  "title",
  "description",
  "body",
  "links",
  "tags",
  "location_name",
  "address1",
  "address2",
  "city",
  "province",
  "postal_code",
  "country",
  "latitude",
  "longitude",
  "sector",
  "methods"
];

const getThingByType_id_lang_userId = async function(
  type,
  thingid,
  lang,
  userId
) {
  let table = type + "s";
  let case_only = "";
  if (type === "case") {
    case_only =
      `get_object_title(cases.is_component_of, '${
        lang
      }') AS is_component_of,\n` +
      `get_components(${thingid}, '${lang}') AS has_components,\n` +
      `get_methods(cases, '${lang}') AS process_methods,\n` +
      `get_organizations(cases, '${lang}') AS primary_organizers,`;
  }

  const thingRow = await db.one(THING_BY_ID, {
    table,
    type,
    thingid,
    lang,
    userId,
    case_only
  });
  const thing = thingRow.results;
  // massage results for display
  if (thing.images.length) {
    thing.images = thing.images.map(
      img => process.env.AWS_UPLOADS_URL + encodeURIComponent(img)
    );
  }
  if (thing.longitude.startsWith("0° 0' 0\"")) {
    thing.longitude = "";
  }
  if (thing.latitude.startsWith("0° 0' 0\"")) {
    thing.latitude = "";
  }

  return thing;
};

const getThingByRequest = async function(type, req) {
  const thingid = as.number(req.params.thingid);
  const lang = as.value(req.params.language || "en");
  const userId = req.user ? req.user.user_id : null;
  return await getThingByType_id_lang_userId(type, thingid, lang, userId);
};

const returnByType = req => {
  // handle json requests from old client or tests
  let returnType = req.query.returns;
  if (req.accepts("json", "html") === "json") {
    returnType = "json";
  }
  switch (returnType) {
    case "htmlfrag":
      return (res, type, thing, staticText) =>
        res.status(200).render(type + "_view", {
          article: thing,
          static: staticText,
          layout: false
        });
    case "json":
      return (res, type, thing, staticText) =>
        res.status(200).json({ OK: true, article: thing, static: staticText });
    case "csv":
      // TODO: implement CSV
      return (res, type, thing) =>
        res.status(500, "CSV not implemented yet").render();
    case "xml":
      // TODO: implement XML
      return (res, type, thing) =>
        res.status(500, "XML not implemented yet").render();
    case "html": // fall through
    default:
      return (res, type, thing, staticText) =>
        res
          .status(200)
          .render(type + "_view", { article: thing, static: staticText });
  }
};

const returnThingByRequest = async function(type, req, res) {
  try {
    const lang = as.value(req.params.language || "en");
    const thing = await getThingByRequest(type, req);
    // FIXME: Specify 'edit' or 'view' for static text
    const staticText = await db.one(
      `select * from ${type}_view_localized where language = '${lang}';`
    );
    Object.keys(thing).forEach(key => {
      if (thing[key] === "{}") {
        thing[key] = [];
      }
    });
    returnByType(req)(res, type, thing, staticText);
  } catch (error) {
    log.error("Exception in GET /%s/%s => %s", type, req.params.thingid, error);
    res.status(500).json({
      OK: false,
      error: error
    });
  }
};

/* I can't believe basic set operations are not part of ES5 Sets */
Set.prototype.difference = function(setB) {
  var difference = new Set(this);
  for (var elem of setB) {
    difference.delete(elem);
  }
  return difference;
};

function compareItems(a, b) {
  const aKeys = new Set(Object.keys(a));
  const bKeys = new Set(Object.keys(b));
  const keysNotInA = bKeys.difference(aKeys);
  if (keysNotInA.size) {
    console.error("Keys in update not found in original: %o", keysNotInA);
  }
  const keysNotInB = aKeys.difference(bKeys);
  if (keysNotInB.size) {
    console.error("Keys in original not found in update: %o", keysNotInB);
  }
}

function getEditXById(type) {
  return async function editById(req, res) {
    cache.clear();
    const thingid = req.thingid || as.number(req.params.thingid);
    try {
      // FIXME: Figure out how to get all of this done as one transaction
      const lang = as.value(req.params.language || "en");
      const user = req.user;
      const userId = user.user_id;
      const oldThing = await getThingByType_id_lang_userId(
        type,
        thingid,
        lang,
        userId
      );
      const newThing = req.body;
      // console.log("Received from client: >>> \n%s\n", JSON.stringify(newThing));
      // console.log("User: %s", JSON.stringify(user));
      let updatedText = {
        body: oldThing.body,
        title: oldThing.title,
        description: oldThing.description,
        language: lang,
        type: type,
        id: thingid
      };
      let updatedThingFields = [];
      let isTextUpdated = false;
      let anyChanges = false;
      let retThing = null;

      /* DO ALL THE DIFFS */
      // FIXME: Does this need to be async?
      Object.keys(oldThing).forEach(async key => {
        // console.error("checking key %s", key);
        const prevValue = oldThing[key];
        let value = newThing[key];
        if (key === "body" && value === "case_body_placeholder") {
          value = "";
        }
        if (
          // All the ways to check if a value has not changed
          // Fixme, check list of ids vs. list of {id, title} pairs
          value === undefined ||
          equals(prevValue, value) ||
          (/_date/.test(key) &&
            moment(prevValue).format() === moment(value).format())
        ) {
          // skip, do nothing, no change for this key
        } else if (!equals(prevValue, value)) {
          anyChanges = true;
          // If the body, title, or description have changed: add a record in localized_texts
          if (key === "body" || key === "title" || key == "description") {
            updatedText[key] = value;
            isTextUpdated = true;
            // If any of the fields of thing itself have changed, update record in appropriate table
          } else if (
            [
              "id",
              "post_date",
              "updated_date",
              "authors",
              "creator",
              "last_updated_by"
            ].includes(key)
          ) {
            log.warn(
              "Trying to update a field users shouldn't update: %s",
              key
            );
            // take no action
          } else if (key === "featured" || key === "hidden") {
            if (user.isadmin) {
              updatedThingFields.push({
                key: as.name(key),
                value: Boolean(value)
              });
            } else {
              log.warn(
                "Non-admin trying to update Featured/hidden flag: %s",
                JSON.stringify(user)
              );
              // take no action
            }
          } else if (
            // fields that are lists of strings
            [
              "tags",
              "links",
              "images",
              "videos",
              "files",
              "if_voting",
              "evaluation_reports",
              "evaluation_links"
            ].includes(key)
          ) {
            updatedThingFields.push({
              key: as.name(key),
              value: as.strings(value)
            });
          } else if (
            // fields that are arrays of text (localized), value pairs
            [
              "issues",
              "relationships",
              "specific_topics",
              "approaches",
              "change_types",
              "decision_methods",
              "funder_types",
              "implementers_of_change",
              "insights_outcomes",
              "learning_resources",
              "organizer_types",
              "purposes",
              "participants_interactions",
              "targeted_participants",
              "typical_purposes",
              "communication_outcomes",
              "communication_modes"
            ].includes(key)
          ) {
            updatedThingFields.push({
              key: as.name(key),
              value: as.localed(value)
            });
          } else if (key === "is_component_of") {
            let component_id = value;
            if (value === null) {
              // delete any existing value
            } else if (typeof value !== "number") {
              component_id = value.value;
            }
            if (component_id !== thingid) {
              if (oldThing.is_component_of !== component_id) {
                updatedThingFields.push({
                  key: as.name(key),
                  value: component_id ? as.number(component_id) : null
                });
              }
            } else {
              // console.warn(
              //   "Do NOT try to add an element as a component of itself or I WILL smack you."
              // );
            }
          } else if (key === "has_components") {
            /* Allow has_components to update those other cases */
            /* trickier, need to make current component the is_component_of for each id */
            /* objects are {label, text, value} where value is the id */
            /* FUCK this gets hard when trying to remove items, and is easily broken by multiple users, remove it */
            // DO NOTHING
          } else if (["process_methods", "primary_organizers"].includes(key)) {
            updatedThingFields.push({
              key: as.name(key),
              value: as.array(value.map(x => x.value))
            });
          } else if (key === "bookmarked") {
            /* FIXME: Move bookmarked API to be a normal update */
            /* stored in a separate table, tied to user */
            console.error("bookmarked: %s", newThing[key]);
          } else if (key === "primary_organizers") {
            updatedThingFields.push({
              key: as.name(key),
              value: as.ids(newThing[key])
            });
          } else {
            let value = newThing[key];
            let asValue = as.text;
            if (typeof value === "boolean") {
              asValue = as.value;
            } else if (value === null) {
              value = "null";
              asValue = as.value;
            } else if (typeof value === "number") {
              asValue = as.number;
            }
            updatedThingFields.push({
              key: as.name(key),
              value: asValue(value)
            });
          }
        }
      }); // end of for loop over object keys
      // console.error("looped through all keys");
      if (true) {
        // Actually make the changes
        if (isTextUpdated) {
          // INSERT new text row
          await db.none(INSERT_LOCALIZED_TEXT, updatedText);
        }
        // Update last_updated
        updatedThingFields.push({ key: "updated_date", value: as.text("now") });
        // UPDATE the thing row
        await db.none(UPDATE_NOUN, {
          keyvalues: updatedThingFields
            .map(field => field.key + " = " + field.value)
            .join(", "),
          type: type,
          id: thingid
        });
        // INSERT row for X__authors
        await db.none(INSERT_AUTHOR, {
          user_id: userId,
          type: type,
          id: thingid
        });
        // update materialized view for search
        retThing = await getThingByType_id_lang_userId(
          type,
          as.number(thingid),
          lang,
          userId
        );
        if (req.thingid) {
          res.status(201).json({
            OK: true,
            data: { thingid: retThing.id },
            object: retThing
          });
        } else {
          res.status(200).json({ OK: true, data: retThing });
        }
      }
    } catch (error) {
      log.error(
        "Exception in PUT /%s/%s => %s",
        type,
        req.thingid || thingid,
        error
      );
      console.trace(error);
      res.status(500).json({
        OK: false,
        error: error
      });
    } // end catch
    // update search index
    try {
      db.none("REFRESH MATERIALIZED VIEW CONCURRENTLY search_index_en;");
    } catch (error) {
      console.error("Problem refreshing materialized view: %s", error);
    }
  };
}

const supportedTypes = ["case", "method", "organization"];

module.exports = {
  getThingByType_id_lang_userId,
  getThingByRequest,
  returnThingByRequest,
  getEditXById,
  supportedTypes,
  titleKeys,
  shortKeys,
  mediumKeys,
  thingKeys,
  caseKeys,
  methodKeys,
  organizationKeys
};
