"use strict";
const express = require("express");
const cache = require("apicache");
const log = require("winston");
const equals = require("deep-equal");
const fs = require("fs");

const {
  db,
  as,
  CASES_BY_COUNTRY,
  CREATE_CASE,
  CASE_BY_ID,
  INSERT_AUTHOR,
  INSERT_LOCALIZED_TEXT,
  UPDATE_CASE,
  listUsers,
  listCases,
  listMethods,
  listOrganizations,
  refreshSearch,
  ErrorReporter
} = require("../helpers/db");

const {
  setConditional,
  maybeUpdateUserText,
  parseGetParams,
  returnByType,
  fixUpURLs
} = require("../helpers/things");

const requireAuthenticatedUser = require("../middleware/requireAuthenticatedUser.js");
const CASE_STRUCTURE = JSON.parse(
  fs.readFileSync("api/helpers/data/case-structure.json", "utf8")
);
const sharedFieldOptions = require("../helpers/shared-field-options.js");

/**
 * @api {post} /case/new Create new case
 * @apiGroup Cases
 * @apiVersion 0.1.0
 * @apiName newCase
 *
 * @apiSuccess {Boolean} OK true if call was successful
 * @apiSuccess {String[]} errors List of error strings (when `OK` is false)
 * @apiSuccess {Object} data case data
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "OK": true,
 *       "data": {
 *         "ID": 3,
 *         "Description": 'foo'
 *        }
 *     }
 *
 * @apiError NotAuthenticated The user is not authenticated
 * @apiError NotAuthorized The user doesn't have permission to perform this operation.
 *
 */

async function postCaseNewHttp(req, res) {
  // create new `case` in db
  try {
    cache.clear();
    let title = req.body.title;
    let body = req.body.body || req.body.summary || "";
    let description = req.body.description;
    let language = req.body.original_language || "en";
    if (!title) {
      return res.status(400).json({
        OK: false,
        errors: ["Cannot create a case without at least a title."]
      });
    }
    const user_id = req.user.id;
    const thing = await db.one(CREATE_CASE, {
      title,
      body,
      description,
      language
    });
    //    req.thingid = thing.thingid;
    req.params.thingid = thing.thingid;
    await postCaseUpdateHttp(req, res);
  } catch (error) {
    log.error("Exception in POST /case/new => %s", error);
    res.status(400).json({ OK: false, error: error });
  }
}

/**
 * @api {put} /case/:caseId  Submit a new version of a case
 * @apiGroup Cases
 * @apiVersion 0.1.0
 * @apiName editCase
 * @apiParam {Number} caseId Case ID
 *
 * @apiSuccess {Boolean} OK true if call was successful
 * @apiSuccess {String[]} errors List of error strings (when `OK` is false)
 * @apiSuccess {Object} data case data
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "OK": true,
 *       "data": {
 *         "ID": 3,
 *         "Description": 'foo'
 *        }
 *     }
 *
 * @apiError NotAuthenticated The user is not authenticated
 * @apiError NotAuthorized The user doesn't have permission to perform this operation.
 *
 */

function getUpdatedCase(user, params, newCase, oldCase) {
  const updatedCase = Object.assign({}, oldCase);
  const er = new ErrorReporter();
  const cond = (key, fn) => setConditional(updatedCase, newCase, er, fn, key);
  // admin-only
  if (user.isadmin) {
    cond("featured", as.boolean);
    cond("hidden", as.boolean);
    cond("original_language", as.text);
    cond("post_date", as.date);
  }

  // media lists
  ["links", "videos", "audio", "evaluation_links"].map(key =>
    cond(key, as.media)
  );
  // photos and files are slightly different from other media as they have a source url too
  ["photos", "files", "evaluation_reports"].map(key =>
    cond(key, as.sourcedMedia)
  );
  // boolean (would include "published" but we don't really support it)
  ["ongoing", "staff", "volunteers"].map(key => cond(key, as.boolean));
  // yes/no (convert to boolean)
  ["impact_evidence", "formal_evaluation"].map(key => cond(key, as.yesno));
  // integer
  ["number_of_participants"].map(key => cond(key, as.integer));
  // float
  ["latitude", "longitude"].map(key => cond(key, as.float));
  // plain text
  [
    "location_name",
    "address1",
    "address2",
    "city",
    "province",
    "postal_code",
    "country",
    "funder"
  ].map(key => cond(key, as.text));
  // date
  ["start_date", "end_date"].map(key => cond(key, as.date));
  // id
  ["is_component_of", "primary_organizer"].map(key => cond(key, as.id));
  // list of ids
  ["specific_methods_tools_techniques"].map(key => cond(key, as.ids));
  // key
  [
    "scope_of_influence",
    "public_spectrum",
    "legality",
    "facilitators",
    "facilitator_training",
    "facetoface_online_or_both",
    "open_limited",
    "recruitment_method",
    "time_limited"
  ].map(key => cond(key, as.casekeyflat));
  // list of keys
  [
    "general_issues",
    "specific_topics",
    "purposes",
    "approaches",
    "targeted_participants",
    "method_types",
    "participants_interactions",
    "learning_resources",
    "decision_methods",
    "if_voting",
    "insights_outcomes",
    "organizer_types",
    "funder_types",
    "change_types",
    "implementers_of_change",
    "tools_techniques_types"
  ].map(key => cond(key, as.casekeys));
  // special list of keys
  ["tags"].map(key => cond(key, as.tagkeys));
  // TODO save bookmarked on user
  return [updatedCase, er];
}

// Only changes to title, description, and/or body trigger a new author and version

async function postCaseUpdateHttp(req, res) {
  // cache.clear();
  const params = parseGetParams(req, "case");
  const user = req.user;
  const { articleid, type, view, userid, lang, returns } = params;
  const newCase = req.body;

  // if this is a new case, we don't have a post_date yet, so we set it here
  if (!newCase.post_date) {
    newCase.post_date = Date.now();
  }

  // console.log(
  //   "Received tools_techniques_types from client: >>> \n%s\n",
  //   JSON.stringify(newCase.tools_techniques_types, null, 2)
  // );
  // save any changes to the user-submitted text
  const {
    updatedText,
    author,
    oldArticle: oldCase
  } = await maybeUpdateUserText(req, res, "case");
  // console.log("oldCase: %s", JSON.stringify(oldCase, null, 2));
  // console.log("updatedText: %s", JSON.stringify(updatedText));
  // console.log("author: %s", JSON.stringify(author));
  const [updatedCase, er] = getUpdatedCase(user, params, newCase, oldCase);
  //console.log("updated case: %s", JSON.stringify(updatedCase, null, 2));
  if (!er.hasErrors()) {
    if (updatedText) {
      await db.tx("update-case", t => {
        return t.batch([
          t.none(INSERT_AUTHOR, author),
          t.none(INSERT_LOCALIZED_TEXT, updatedText),
          t.none(UPDATE_CASE, updatedCase)
        ]);
      });
    } else {
      await db.tx("update-case", t => {
        return t.batch([
          t.none(INSERT_AUTHOR, author),
          t.none(UPDATE_CASE, updatedCase)
        ]);
      });
    }
    // the client expects this request to respond with json
    // save successful response
    // console.log("Params for returning case: %s", JSON.stringify(params));
    const freshArticle = await getCase(params, res);
    // console.log("fresh article: %s", JSON.stringify(freshArticle, null, 2));
    res.status(200).json({
      OK: true,
      article: freshArticle
    });
    refreshSearch();
  } else {
    console.error("Reporting errors: %s", er.errors);
    res.status(400).json({
      OK: false,
      errors: er.errors
    });
  }
}

/**
 * @api {get} /case/:thingid Get the last version of a case
 * @apiGroup Cases
 * @apiVersion 0.1.0
 * @apiName returnCaseById
 * @apiParam {Number} thingid Case ID
 *
 * @apiSuccess {Boolean} OK true if call was successful
 * @apiSuccess {String[]} errors List of error strings (when `OK` is false)
 * @apiSuccess {Object} data case data
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "OK": true,
 *       "data": {
 *         "ID": 3,
 *         "Description": 'foo'
 *        }
 *     }
 *
 * @apiError NotAuthenticated The user is not authenticated
 * @apiError NotAuthorized The user doesn't have permission to perform this operation.
 *
 */

async function getCase(params, res) {
  try {
    const articleRow = await db.one(CASE_BY_ID, params);
    const article = articleRow.results;
    fixUpURLs(article);
    return article;
  } catch (error) {
    // if no entry is found, render the 404 page
    return res.sendStatus("404");
  }
}

async function getCaseHttp(req, res) {
  /* This is the entry point for getting an article */
  const params = parseGetParams(req, "case");
  const article = await getCase(params, res);
  const staticText = await getEditStaticText(params);
  returnByType(res, params, article, staticText, req.user);
}

function print(name, obj) {
  console.log("%s: %s", name, JSON.stringify(obj, null, 2));
}

async function getEditStaticText(params) {
  const lang = params.lang;
  let staticText = Object.assign({}, sharedFieldOptions);
  staticText.authors = listUsers();
  staticText.cases = listCases(lang).filter(article => !article.hidden);
  staticText.methods = listMethods(lang).filter(article => !article.hidden);
  staticText.organizations = listOrganizations(lang).filter(article => !article.hidden);
  return staticText;
}

async function getCaseEditHttp(req, res) {
  let startTime = new Date();
  const params = parseGetParams(req, "case");
  params.view = "edit";
  const article = await getCase(params, res);
  const staticText = await getEditStaticText(params);
  returnByType(res, params, article, staticText, req.user);
}

async function getCaseNewHttp(req, res) {
  const params = parseGetParams(req, "case");
  params.view = "edit";
  const article = CASE_STRUCTURE;
  const staticText = await getEditStaticText(params);
  returnByType(res, params, article, staticText, req.user);
}

const router = express.Router(); // eslint-disable-line new-cap
router.get("/:thingid/edit", requireAuthenticatedUser(), getCaseEditHttp);
router.get("/new", requireAuthenticatedUser(), getCaseNewHttp);
router.post("/new", requireAuthenticatedUser(), postCaseNewHttp);
router.get("/:thingid", getCaseHttp);
router.post("/:thingid", requireAuthenticatedUser(), postCaseUpdateHttp);

module.exports = {
  case_: router,
  getCaseEditHttp,
  getCaseNewHttp,
  postCaseNewHttp,
  getCaseHttp,
  postCaseUpdateHttp
};
