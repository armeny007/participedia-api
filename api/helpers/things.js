let { isString } = require("lodash");
let log = require("winston");
const cache = require("apicache");
const equals = require("deep-equal");
const moment = require("moment");

const {
  as,
  db,
  INSERT_LOCALIZED_TEXT,
  UPDATE_NOUN,
  INSERT_AUTHOR,
  CASE_BY_ID,
  METHOD_BY_ID,
  ORGANIZATION_BY_ID
} = require("./db");

// Define the keys we're testing (move these to helper/things.js ?
const titleKeys = ["id", "title"];
const shortKeys = titleKeys.concat([
  "type",
  "photos",
  "post_date",
  "updated_date",
  "bookmarked"
]);
const mediumKeys = shortKeys.concat(["body", "location"]);

function fixedEncodeURIComponent(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
    return "%" + c.charCodeAt(0).toString(16);
  });
}

function getLanguage(req) {
  // once we have translations for user generated content in all supported languages,
  // we can use the locale cookie to query by language.
  // currently if the locale is set to something other than "en", no results are returned,
  // so hardcoding "en" here
  // return req.cookies.locale || "en";
  return "en";
}

function encodeURL(url) {
  if (url.startsWith("http")) {
    return url;
  } else {
    return process.env.AWS_UPLOADS_URL + fixedEncodeURIComponent(url);
  }
}

function randomTexture() {
  let index = Math.floor(Math.random() * 6) + 1;
  return `/images/texture_${index}.svg`;
}

const fixUpURLsWithRandomTexture = function(article) {
  fixUpURLs(article, true);
}

const fixUpURLs = function(article, useRandomTexture) {
  // FIXME: need to handle all media objects and source_urls for sourced media
  if (article.photos) {
    if (article.photos.length) {
    article.photos.forEach(obj => {
      obj.url = encodeURL(obj.url);
    });
    }
    else if (useRandomTexture) { // article photo is empty array
      article.photos = [{ url: randomTexture() }];      
    }
  }
  if (article.files && article.files.length) {
    article.files.forEach(obj => {
      obj.url = encodeURL(obj.url);
    });
  }
};

const returnByType = (res, params, article, static, user) => {
  const { returns, type, view } = params;

  // if article is hidden and user is not admin, return 404
  if (article.hidden && (!user || (user && !user.isadmin))) {
    return res.status(404).render("404");
  }

  switch (returns) {
    case "htmlfrag":
      return res.status(200).render(type + "-" + view, {
        article,
        static,
        user,
        params,
        layout: false
      });
    case "json":
      return res.status(200).json({ OK: true, article });
    case "csv":
      // TODO: implement CSV
      return res.status(500, "CSV not implemented yet").render();
    case "xml":
      // TODO: implement XML
      return res.status(500, "XML not implemented yet").render();
    case "html": // fall through
    default:
      return res
        .status(200)
        .render(type + "-" + view, { article, static, user, params });
  }
};

const parseGetParams = function(req, type) {
  return Object.assign({}, req.query, {
    type,
    view: as.value(req.params.view || "view"),
    articleid: as.number(req.params.thingid || req.params.articleid),
    lang: as.value(getLanguage(req)),
    userid: req.user ? as.number(req.user.id) : null,
    returns: as.value(req.query.returns || "html")
  });
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

const supportedTypes = ["case", "method", "organization"];

/** uniq ::: return a list with no repeated items. Items will be in the order they first appear in the list. **/
const uniq = list => {
  let newList = [];
  list.forEach(item => {
    if (!newList.includes(item)) {
      newList.push(item);
    }
  });
  return newList;
};

let queries = {
  case: CASE_BY_ID,
  method: METHOD_BY_ID,
  organization: ORGANIZATION_BY_ID
};

async function maybeUpdateUserText(req, res, type) {
  // keyFieldsToObjects is a temporary workaround while we move from {key, value} objects to keys
  // if none of the user-submitted text fields have changed, don't add a record
  // to localized_text or
  const newArticle = req.body;
  const params = parseGetParams(req, type);
  const oldArticle = (await db.one(queries[type], params)).results;
  if (!oldArticle) {
    throw new Error("No %s found for id %s", type, params.articleid);
  }
  fixUpURLs(oldArticle);
  let textModified = false;
  const updatedText = {
    body: oldArticle.body,
    title: oldArticle.title,
    description: oldArticle.description,
    language: params.lang,
    type: type,
    id: params.articleid
  };
  ["body", "title", "description"].forEach(key => {
    let value;
    if (key === "body") {
      value = as.richtext(newArticle[key] || '');
    } else {
      value = as.text(newArticle[key] || '');
    }
    if (newArticle[key] !== oldArticle[key]) {
      textModified = true;
    }
    updatedText[key] = value;
  });
  const author = {
    user_id: params.userid,
    thingid: params.articleid
  };
  if (textModified) {
    return { updatedText, author, oldArticle };
  } else {
    return { updatedText: null, author, oldArticle };
  }
}

function setConditional(
  updatedObject,
  newObject,
  errorReporter,
  updateFunction,
  key
) {
  if (newObject[key] === undefined) {
    // if we're updating a partial, we still need to rewrite the updated object
    // from front-end format to save format
    updatedObject[key] = errorReporter.try(updateFunction)(
      updatedObject[key],
      key
    );
  } else {
    updatedObject[key] = errorReporter.try(updateFunction)(newObject[key], key);
  }
}

module.exports = {
  supportedTypes,
  titleKeys,
  shortKeys,
  mediumKeys,
  uniq,
  fixUpURLs,
  parseGetParams,
  returnByType,
  setConditional,
  maybeUpdateUserText,
  randomTexture,
  fixUpURLsWithRandomTexture
};
