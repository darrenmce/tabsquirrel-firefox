"use strict";

const {Cu} = require("chrome");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/Sqlite.jsm");

const Promise = require('sdk/core/promise');

const DB_VERSION = 1;

const SCHEMA = {
  tables : {
    squirrel_tabs :
      "CREATE TABLE squirrel_tabs (" +
      "  id INTEGER PRIMARY KEY" +
      ", session_id INTEGER NOT NULL" +
      ", url TEXT NOT NULL" +
      ", title TEXT NOT NULL" +
      ", timestamp INTEGER NOT NULL" +
      ")"
    ,
    squirrel_sessions :
      "CREATE TABLE squirrel_sessions (" +
      "  id INTEGER PRIMARY KEY" +
      ", timestamp INTEGER NOT NULL" +
      ")"
    ,
    squirrel_sessions_tabs :
      "CREATE TABLE squirrel_sessions_tabs (" +
      "  tab_id INTEGER NOT NULL" +
      ", session_id INTEGER NOT NULL" +
      ")"
    ,
  },
  indices : {
    squirrel_tabs_timestamp_index : {
      table   : "squirrel_tabs",
      columns : ["timestamp"]
    },
    squirrel_sessions_timestamp_index : {
      table   : "squirrel_sessions",
      columns : ["timestamp"]
    },
    squirrel_sessions_tabs_tab_index : {
      table   : "squirrel_sessions_tabs",
      columns : ["tab_id"]
    },
    squirrel_sessions_tabs_session_index : {
      table   : "squirrel_sessions_tabs",
      columns : ["session_id"]
    },
  }
};

let TabDatabase = {

  //////////////////////////////////////////////////////////////////////////////
  //// Fields

  // Sqlite connection
  _dbConnectionPromise: null,

  //////////////////////////////////////////////////////////////////////////////
  //// Public API

  /**
   * Opens and caches new connection
   *
   * @returns Promise resulting in an established connection
  */
  get DBConnectionPromise() {
    if (this._dbConnectionPromise == null) {
      this._dbConnectionPromise = this._openDatabaseConnection();
    }
    return this._dbConnectionPromise;
  },

  /**
   * returns a promise resolved to migration flag
   *
   * @returns Promise resolving to true upon creation or migration
  */
  getDbMigrationPromise: function ID_getDbMigrationPromise() {
    return this._dbMigrationPromiseDeferred.promise;
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Helpers

  /**
   * Opens a Sqlite connection to interests database
   *
   * @returns Promise resulting in an established connection
  */
  _openDatabaseConnection: function ID__openDatabaseConnection() {
    let dbFile = Services.dirsvc.get("ProfD", Ci.nsIFile).clone();
    dbFile.append("interests.sqlite");

    return Task.spawn(function () {
      let connection = yield Sqlite.openConnection({
         path: dbFile.path,
         sharedMemoryCache: false,
      });

      try {
        connection.isMigrated = yield this._dbInit(connection);
      }
      catch (ex) {
        yield connection.close();
        throw ex;
      }

      // Be sure to cleanly close this connection.
      Services.obs.addObserver(function DBCloseCallback(aSubject, aTopic, aData) {
        Services.obs.removeObserver(DBCloseCallback, aTopic);
        connection.close();
      }, "profile-change-teardown", false);

      throw new Task.Result(connection);
    }.bind(this));
  },


  /*
   * Attempts to popuate or migrate a database
   *
   * @param   connection
   *          an established connection
   * @returns Promise of completion resolved to migration/creation flag
   */
  _dbInit: function TD__dbInit(connection) {
    return connection.getSchemaVersion().then(version => {
      if (version == 0) {
        return this._dbCreate(connection).then(() => {
          return true;
        });
      }
      else if (version != DB_VERSION) {
        return this._dbMigrate(connection,version).then(() => {
          return true;
        });
      }
      else {
        return false;
      }
    });
  },

  /*
   * Creates Schema tables and indexes
   *
   * @param   connection
   *          an established connection
   * @returns Promise of the task completion
   */
  _dbCreate: function ID__dbCreate(connection) {
    let promises = [];
    for (let name in SCHEMA.tables) {
      let statement = SCHEMA.tables[name];
      promises.push(connection.execute(statement));
    }

    for (let name in SCHEMA.indices) {
      let index = SCHEMA.indices[name];
      let statement = "CREATE INDEX IF NOT EXISTS " + name + " ON " + index.table +
              "(" + index.columns.join(", ") + ")";
      promises.push(connection.execute(statement));
    }
    promises.push(connection.setSchemaVersion(DB_VERSION));
    return Promise.promised(Array)(promises).then();
  },

  /*
   * Migrates database
   *
   * @param   connection
   *          an established connection
   * @param   version
   *          old version of database
   * @returns Promise of the task completion
   *          currently resolves immediately
   */
  _dbMigrate: function ID__dbMigrate(connection,version) {
     let deferred = Promise.defer();
     deferred.resolve(connection);
     return deferred.promise;
   },
}

exports.TabDatabase = TabDatabase;