/*!
 * ${copyright}
 */

//Provides class sap.ui.model.odata.v4.ODataListBinding
sap.ui.define([
	"jquery.sap.global",
	"sap/ui/model/Binding",
	"sap/ui/model/ChangeReason",
	"sap/ui/model/FilterOperator",
	"sap/ui/model/FilterType",
	"sap/ui/model/ListBinding",
	"sap/ui/model/Sorter",
	"sap/ui/model/odata/OperationMode",
	"./Context",
	"./lib/_Cache",
	"./lib/_Helper",
	"./lib/_SyncPromise",
	"./ODataParentBinding"
], function (jQuery, Binding, ChangeReason, FilterOperator, FilterType, ListBinding, Sorter,
		OperationMode, Context, _Cache, _Helper, _SyncPromise, asODataParentBinding) {
	"use strict";

	var sClassName = "sap.ui.model.odata.v4.ODataListBinding",
		mSupportedEvents = {
			change : true,
			dataReceived : true,
			dataRequested : true,
			refresh : true
		};

	/**
	 * Do <strong>NOT</strong> call this private constructor, but rather use
	 * {@link sap.ui.model.odata.v4.ODataModel#bindList} instead!
	 *
	 * @param {sap.ui.model.odata.v4.ODataModel} oModel
	 *   The OData V4 model
	 * @param {string} sPath
	 *   The binding path in the model; must not end with a slash
	 * @param {sap.ui.model.Context} [oContext]
	 *   The parent context which is required as base for a relative path
	 * @param {sap.ui.model.Sorter | sap.ui.model.Sorter[]} [vSorters]
	 *   The dynamic sorters to be used initially. Call {@link #sort} to replace them. Static
	 *   sorters, as defined in the '$orderby' binding parameter, are always executed after the
	 *   dynamic sorters.
	 *   Supported since 1.39.0.
	 * @param {sap.ui.model.Filter | sap.ui.model.Filter[]} [vFilters]
	 *   The dynamic application filters to be used initially. Call {@link #filter} to replace them.
	 *   Static filters, as defined in the '$filter' binding parameter, are always combined with the
	 *   dynamic filters using a logical <code>AND</code>.
	 *   Supported since 1.39.0.
	 * @param {object} [mParameters]
	 *   Map of binding parameters which can be OData query options as specified in
	 *   "OData Version 4.0 Part 2: URL Conventions" or the binding-specific parameters "$$groupId"
	 *   and "$$updateGroupId".
	 *   Note: If parameters are provided for a relative binding path, the binding accesses data
	 *   with its own service requests instead of using its parent binding.
	 *   The following OData query options are allowed:
	 *   <ul>
	 *   <li> All "5.2 Custom Query Options" except for those with a name starting with "sap-"
	 *   <li> The $apply, $expand, $filter, $orderby, $search and $select "5.1 System Query Options"
	 *   </ul>
	 *   All other query options lead to an error.
	 *   Query options specified for the binding overwrite model query options.
	 * @param {sap.ui.model.odata.OperationMode} [mParameters.$$operationMode]
	 *   The operation mode for sorting with the model's operation mode as default. Since 1.39.0,
	 *   the operation mode {@link sap.ui.model.odata.OperationMode.Server} is supported. All other
	 *   operation modes including <code>undefined</code> lead to an error if 'vFilters' or
	 *   'vSorters' are given or if {@link #filter} or {@link #sort} is called.
	 * @param {string} [mParameters.$$groupId]
	 *   The group ID to be used for <b>read</b> requests triggered by this binding; if not
	 *   specified, either the parent binding's group ID (if the binding is relative) or the
	 *   model's group ID is used, see {@link sap.ui.model.odata.v4.ODataModel#constructor}.
	 *   Valid values are <code>undefined</code>, '$auto', '$direct' or application group IDs as
	 *   specified in {@link sap.ui.model.odata.v4.ODataModel#submitBatch}.
	 * @param {string} [mParameters.$$updateGroupId]
	 *   The group ID to be used for <b>update</b> requests triggered by this binding;
	 *   if not specified, either the parent binding's update group ID (if the binding is relative)
	 *   or the model's update group ID is used,
	 *   see {@link sap.ui.model.odata.v4.ODataModel#constructor}.
	 *   For valid values, see parameter "$$groupId".
	 * @throws {Error}
	 *   If disallowed binding parameters are provided or an unsupported operation mode is used
	 *
	 * @alias sap.ui.model.odata.v4.ODataListBinding
	 * @author SAP SE
	 * @class List binding for an OData V4 model.
	 *   An event handler can only be attached to this binding for the following events: 'change',
	 *   'dataReceived', 'dataRequested', and 'refresh'.
	 *   For other events, an error is thrown.
	 * @extends sap.ui.model.ListBinding
	 * @mixes sap.ui.model.odata.v4.ODataParentBinding
	 * @public
	 * @since 1.37.0
	 * @version ${version}
	 * @borrows sap.ui.model.odata.v4.ODataBinding#hasPendingChanges as #hasPendingChanges
	 * @borrows sap.ui.model.odata.v4.ODataBinding#isInitial as #isInitial
	 * @borrows sap.ui.model.odata.v4.ODataBinding#refresh as #refresh
	 * @borrows sap.ui.model.odata.v4.ODataBinding#resetChanges as #resetChanges
	 * @borrows sap.ui.model.odata.v4.ODataBinding#resume as #resume
	 * @borrows sap.ui.model.odata.v4.ODataBinding#suspend as #suspend
	 * @borrows sap.ui.model.odata.v4.ODataParentBinding#initialize as #initialize
	 */
	var ODataListBinding = ListBinding.extend("sap.ui.model.odata.v4.ODataListBinding", {
			constructor : function (oModel, sPath, oContext, vSorters, vFilters, mParameters) {
				ListBinding.call(this, oModel, sPath);

				if (sPath.slice(-1) === "/") {
					throw new Error("Invalid path: " + sPath);
				}

				this.aApplicationFilters = _Helper.toArray(vFilters);
				this.oCache = undefined;
				this.sChangeReason = undefined;
				this.oDiff = undefined;
				this.aFilters = [];
				this.mPreviousContextsByPath = {};
				this.aPreviousData = [];
				this.mQueryOptions = undefined;
				this.sRefreshGroupId = undefined;
				this.aSorters = _Helper.toArray(vSorters);

				this.setParameters(jQuery.extend(true, {}, mParameters));

				if (!this.bRelative) {
					// Note: this.mParameters is ignored for absolute bindings,
					// but this.mQueryOptions is used --> setParameters() must happen before
					this.oCache = this.makeCache();
				}

				this.setContext(oContext);
				oModel.bindingCreated(this);
			}
		});

	asODataParentBinding(ODataListBinding.prototype);

	/**
	 * Deletes the entity identified by the edit URL.
	 *
	 * @param {string} [sGroupId=getUpdateGroupId()]
	 *   The group ID to be used for the DELETE request
	 * @param {string} sEditUrl
	 *   The edit URL to be used for the DELETE request
	 * @param {number} oContext
	 *   The context to be deleted
	 * @returns {Promise}
	 *   A promise which is resolved without a result in case of success, or rejected with an
	 *   instance of <code>Error</code> in case of failure.
	 * @throws {Error}
	 *   If there are pending changes.
	 *
	 * @private
	 */
	ODataListBinding.prototype._delete = function (sGroupId, sEditUrl, oContext) {
		var that = this;

		if (!oContext.isTransient() && this.hasPendingChanges()) {
			throw new Error("Cannot delete due to pending changes");
		}
		return this.deleteFromCache(sGroupId, sEditUrl, String(oContext.iIndex),
			function (iIndex) {
				var i,
					oNextContext;
				if (iIndex === -1) {
					// happens only for a created context that is not transient anymore
					oContext.destroy();
					delete that.aContexts[-1];
				} else {
					for (i = iIndex; i < that.aContexts.length; i += 1) {
						oContext = that.aContexts[i];
						oNextContext = that.aContexts[i + 1];
						if (oContext && !oNextContext) {
							that.mPreviousContextsByPath[oContext.getPath()] = oContext;
							delete that.aContexts[i];
						} else if (!oContext && oNextContext) {
							that.aContexts[i]
								= Context.create(that.oModel, that, that.sPath + "/" + i, i);
						} else {
							oContext.checkUpdate();
						}
					}
					that.aContexts.pop();
					that.iMaxLength -= 1; // this doesn't change Infinity
				}
				that._fireChange({reason : ChangeReason.Remove});
			});
	};

	/**
	 * The 'change' event is fired when the binding is initialized or new contexts are created or
	 * its parent context is changed. It is to be used by controls to get notified about changes to
	 * the binding contexts of this list binding. Registered event handlers are called with the
	 * change reason as parameter.
	 *
	 * @param {sap.ui.base.Event} oEvent
	 * @param {object} oEvent.getParameters
	 * @param {sap.ui.model.ChangeReason} oEvent.getParameters.reason
	 *   The reason for the 'change' event: {@link sap.ui.model.ChangeReason.Change} when the
	 *   binding is initialized and or a new context is created, or
	 *   {@link sap.ui.model.ChangeReason.Context} when the parent context is changed
	 *
	 * @event
	 * @name sap.ui.model.odata.v4.ODataListBinding#change
	 * @public
	 * @see sap.ui.base.Event
	 * @since 1.37.0
	 */

	/**
	 * The 'dataRequested' event is fired directly after data has been requested from a back end.
	 * It is to be used by applications for example to switch on a busy indicator.
	 * Registered event handlers are called without parameters.
	 *
	 * @param {sap.ui.base.Event} oEvent
	 *
	 * @event
	 * @name sap.ui.model.odata.v4.ODataListBinding#dataRequested
	 * @public
	 * @see sap.ui.base.Event
	 * @since 1.37.0
	 */

	/**
	 * The 'dataReceived' event is fired after the back-end data has been processed and the
	 * registered 'change' event listeners have been notified.
	 * It is to be used by applications for example to switch off a busy indicator or to process an
	 * error.
	 * If back-end requests are successful, the event has no parameters. Use the binding's contexts
	 * via {@link #getCurrentContexts oEvent.getSource().getCurrentContexts()} to access the
	 * response data. Note that controls bound to this data may not yet have been updated, meaning
	 * it is not safe for registered event handlers to access data via control APIs.
	 *
	 * If a back-end request fails, the 'dataReceived' event provides an <code>Error</code> in the
	 * 'error' event parameter.
	 *
	 * @param {sap.ui.base.Event} oEvent
	 * @param {object} oEvent.getParameters
	 * @param {Error} [oEvent.getParameters.error] The error object if a back-end request failed.
	 *   If there are multiple failed back-end requests, the error of the first one is provided.
	 *
	 * @event
	 * @name sap.ui.model.odata.v4.ODataListBinding#dataReceived
	 * @public
	 * @see sap.ui.base.Event
	 * @since 1.37.0
	 */

	// See class documentation
	// @override
	// @public
	// @see sap.ui.base.EventProvider#attachEvent
	// @since 1.37.0
	ODataListBinding.prototype.attachEvent = function (sEventId) {
		if (!(sEventId in mSupportedEvents)) {
			throw new Error("Unsupported event '" + sEventId
				+ "': v4.ODataListBinding#attachEvent");
		}
		return ListBinding.prototype.attachEvent.apply(this, arguments);
	};

	/**
	 * Changes this binding's parameters according to the given map of parameters: Parameters with
	 * an <code>undefined</code> value are removed, the other parameters are set, and missing
	 * parameters remain unchanged.
	 *
	 * @param {object} mParameters
	 *   Map of binding parameters, see {@link sap.ui.model.odata.v4.ODataModel#bindList}
	 * @throws {Error}
	 *   If <code>mParameters</code> is missing or contains binding-specific parameters.
	 *
	 * @public
	 * @since 1.45.0
	 */
	ODataListBinding.prototype.changeParameters = function (mParameters) {
		var sKey;

		if (!mParameters) {
			throw new Error("Missing map of binding parameters");
		}
		if (!Object.keys(mParameters).length) {
			return;
		}

		for (sKey in mParameters) {
			if (sKey.indexOf("$$") === 0) {
				throw new Error("Unsupported parameter: " + sKey);
			}
		}
		for (sKey in mParameters) {
			if (mParameters[sKey] === undefined) {
				delete this.mParameters[sKey];
			} else {
				this.mParameters[sKey] = mParameters[sKey];
			}
		}
		this.setParameters(this.mParameters, ChangeReason.Change);
	};

	/**
	 * Build the value for the OData V4 '$orderby' system query option from the given sorters
	 * and the optional static '$orderby' value which is appended to the sorters.
	 *
	 * @param {sap.ui.model.Sorter[]} [aSorters]
	 *   An array of <code>Sorter</code> objects to be converted into corresponding '$orderby'
	 *   string.
	 * @param {string} [sOrderbyQueryOption]
	 *   The static '$orderby' system query option which is appended to the converted 'aSorters'
	 *   parameter.
	 * @returns {string}
	 *   The concatenated '$orderby' system query option
	 * @throws {Error}
	 *   If 'aSorters' contains elements that are not {@link sap.ui.model.Sorter} instances.
	 */
	ODataListBinding.prototype.buildOrderbyOption = function (aSorters, sOrderbyQueryOption) {
		var aOrderbyOptions = [],
			that = this;

		aSorters.forEach(function (oSorter) {
			if (oSorter instanceof Sorter) {
				aOrderbyOptions.push(oSorter.sPath + (oSorter.bDescending ? " desc" : ""));
			} else {
				throw new Error("Unsupported sorter: " + oSorter + " - " + that);
			}
		});
		if (sOrderbyQueryOption) {
			aOrderbyOptions.push(sOrderbyQueryOption);
		}
		return aOrderbyOptions.join(',');
	};

	/*
	 * Checks dependent bindings for updates or refreshes the binding if the canonical path of its
	 * parent context changed.
	 *
	 * @throws {Error} If called with parameters
	 */
	// @override
	ODataListBinding.prototype.checkUpdate = function () {
		var that = this;

		function updateDependents() {
			that._fireChange({reason: ChangeReason.Change});
			that.oModel.getDependentBindings(that).forEach(function (oDependentBinding) {
				oDependentBinding.checkUpdate();
			});
		}

		if (arguments.length > 0) {
			throw new Error("Unsupported operation: v4.ODataListBinding#checkUpdate "
				+ "must not be called with parameters");
		}

		if (this.oCache && this.bRelative && this.oContext.fetchCanonicalPath) {
			this.oContext.fetchCanonicalPath().then(function (sCanonicalPath) {
				if (that.oCache.$canonicalPath !== sCanonicalPath) { // entity of context changed
					that.refreshInternal();
				} else {
					updateDependents();
				}
			})["catch"](function (oError) {
				that.oModel.reportError("Failed to update " + that, sClassName, oError);
			});
		} else {
			updateDependents();
		}
	};

	/**
	 * Creates a new entity and inserts it at the beginning of the list. As long as the binding
	 * contains an entity created via this function, you cannot create another entity. This is only
	 * possible after the creation of the entity has been successfully sent to the server and you
	 * have called {@link #refresh} at the binding or the new entity is deleted in between.
	 *
	 * For creating the new entity, the binding's update group ID is used, see binding parameter
	 * $$updateGroupId of {@link sap.ui.model.odata.v4.ODataModel#bindList}.
	 *
	 * You can call {@link sap.ui.model.odata.v4.Context#delete} to delete the created context
	 * again. As long as the context is transient (see
	 * {@link sap.ui.model.odata.v4.Context#isTransient}), {@link #resetChanges} and a call to
	 * {@link sap.ui.model.odata.v4.ODataModel#resetChanges} with the update group ID as parameter
	 * also delete the created context together with other changes.
	 *
	 * If the creation of the entity on the server failed, the creation is repeated for application
	 * group IDs with the next call of {@link sap.ui.model.odata.v4.ODataModel#submitBatch}. For
	 * '$auto' or '$direct', the creation is repeated automatically with the next update for the
	 * entity.
	 *
	 * @param {object} [oInitialData={}]
	 *   The initial data for the created entity
	 * @returns {sap.ui.model.odata.v4.Context}
	 *   The context object for the created entity
	 * @throws {Error}
	 *   If the binding already contains an entity created via this function, or {@link #create} on
	 *   this binding is not supported.
	 *
	 * @public
	 * @since 1.43.0
	 */
	ODataListBinding.prototype.create = function (oInitialData) {
		var oContext,
			sCreatePath,
			sResolvedPath,
			that = this;

		if (this.aContexts[-1]) {
			throw new Error("Must not create twice");
		}
		if (!this.oCache) {
			throw new Error("Create on this binding is not supported");
		}
		sResolvedPath = this.oModel.resolve(this.sPath, this.oContext);
		sCreatePath = sResolvedPath.slice(1);
		oContext = Context.create(this.oModel, this, sResolvedPath + "/-1", -1,
			this.oCache.create(this.getUpdateGroupId(), sCreatePath, "", oInitialData, function () {
				oContext.destroy();
				delete that.aContexts[-1];
				that._fireChange({reason : ChangeReason.Remove});
			}, function (oError) {
				that.oModel.reportError("POST on '" + sCreatePath
					+ "' failed; will be repeated automatically", sClassName, oError);
			}));

		this.aContexts[-1] = oContext;
		this._fireChange({reason : ChangeReason.Add});

		return oContext;
	};

	/**
	 * Creates contexts for this list binding in the given range for the given result length of
	 * the OData response. Fires change and dataReceived events.
	 *
	 * @param {object} oRange
	 *   The range as returned by {@link #getReadRange}
	 * @param {number} iResultLength
	 *   The number of OData entities read from the cache for the given range
	 * @returns {boolean}
	 *   <code>true</code>, if contexts have been created or <code>isLengthFinal</code> has changed
	 *
	 * @private
	 */
	ODataListBinding.prototype.createContexts = function (oRange, iResultLength) {
		var bChanged = false,
			oContext = this.oContext,
			i,
			bNewLengthFinal,
			oModel = this.oModel,
			sPath = oModel.resolve(this.sPath, oContext),
			sPathWithIndex,
			that = this;

		for (i = oRange.start; i < oRange.start + iResultLength; i += 1) {
			if (this.aContexts[i] === undefined) {
				bChanged = true;
				sPathWithIndex = sPath + "/" + i;
				if (sPathWithIndex in this.mPreviousContextsByPath) {
					this.aContexts[i] = this.mPreviousContextsByPath[sPathWithIndex];
					delete this.mPreviousContextsByPath[sPathWithIndex];
					this.aContexts[i].checkUpdate();
				} else {
					this.aContexts[i] = Context.create(oModel, this, sPathWithIndex, i);
				}
			}
		}
		// destroy previous contexts which are not reused
		if (Object.keys(this.mPreviousContextsByPath).length) {
			sap.ui.getCore().addPrerenderingTask(function () {
				Object.keys(that.mPreviousContextsByPath).forEach(function (sPath) {
					that.mPreviousContextsByPath[sPath].destroy();
					delete that.mPreviousContextsByPath[sPath];
				});
			});
		}
		if (this.aContexts.length > this.iMaxLength) { // upper boundary obsolete: reset it
			this.iMaxLength = Infinity;
		}
		if (iResultLength < oRange.length) {
			this.iMaxLength = oRange.start + iResultLength;
			if (this.aContexts.length > this.iMaxLength) {
				this.aContexts.length = this.iMaxLength;
			}
		}
		bNewLengthFinal = this.aContexts.length === this.iMaxLength;
		if (this.bLengthFinal !== bNewLengthFinal) {
			this.bLengthFinal = bNewLengthFinal;
			// bLengthFinal changed --> send change event even if no new data is available
			bChanged = true;
		}
		return bChanged;
	};

	/**
	 * Deletes the entity in the cache. If the binding doesn't have a cache, it forwards to the
	 * parent binding adjusting the path.
	 *
	 * @param {string} [sGroupId=getUpdateGroupId()]
	 *   The group ID to be used for the DELETE request
	 * @param {string} sEditUrl
	 *   The edit URL to be used for the DELETE request
	 * @param {string} sPath
	 *   The path of the entity relative to this binding
	 * @param {function} fnCallback
	 *   A function which is called after the entity has been deleted from the server and from the
	 *   cache; the index of the entity is passed as parameter
	 * @returns {Promise}
	 *   A promise which is resolved without a result in case of success, or rejected with an
	 *   instance of <code>Error</code> in case of failure.
	 * @throws {Error}
	 *   If the resulting group ID is neither '$auto' nor '$direct'
	 *
	 * @private
	 */
	ODataListBinding.prototype.deleteFromCache = function (sGroupId, sEditUrl, sPath, fnCallback) {
		var oPromise;

		if (this.oCache) {
			sGroupId = sGroupId || this.getUpdateGroupId();
			if (sGroupId !== "$auto" && sGroupId !== "$direct") {
				throw new Error("Illegal update group ID: " + sGroupId);
			}
			oPromise = this.oCache._delete(sGroupId, sEditUrl, sPath, fnCallback);
			return oPromise;
		}
		return this.oContext.getBinding().deleteFromCache(sGroupId, sEditUrl,
			_Helper.buildPath(this.oContext.iIndex, this.sPath, sPath), fnCallback);
	};

	/**
	 * Deregisters the given change listener.
	 *
	 * @param {string} sPath
	 *   The path
	 * @param {sap.ui.model.odata.v4.ODataPropertyBinding} oListener
	 *   The change listener
	 * @param {number} iIndex
	 *   Index corresponding to some current context of this binding
	 *
	 * @private
	 */
	ODataListBinding.prototype.deregisterChange = function (sPath, oListener, iIndex) {
		if (this.oCache) {
			this.oCache.deregisterChange(_Helper.buildPath(iIndex, sPath), oListener);
		} else if (this.oContext) {
			this.oContext.deregisterChange(_Helper.buildPath(this.sPath, iIndex, sPath), oListener);
		}
	};

	/**
	 * Destroys the object. The object must not be used anymore after this function was called.
	 *
	 * @public
	 * @since 1.40.1
	 */
	// @override
	ODataListBinding.prototype.destroy = function () {
		this.aContexts.forEach(function (oContext) {
			oContext.destroy();
		});
		if (this.aContexts[-1]) {
			this.aContexts[-1].destroy();
		}
		this.oModel.bindingDestroyed(this);
		ListBinding.prototype.destroy.apply(this);
	};

	/*
	 * Delegates to {@link sap.ui.model.ListBinding#enableExtendedChangeDetection} while disallowing
	 * the <code>vKey</code> parameter.
	 */
	// @override
	ODataListBinding.prototype.enableExtendedChangeDetection = function (bDetectUpdates, vKey) {
		if (vKey !== undefined) {
			throw new Error("Unsupported property 'key' with value '" + vKey
				+ "' in binding info for " + this);
		}

		return ListBinding.prototype.enableExtendedChangeDetection.apply(this, arguments);
	};

	/**
	 * Requests the value for the given absolute path; the value is requested from this binding's
	 * cache or from its context in case it has no cache or the cache does not contain data for
	 * this path.
	 *
	 * @param {string} sPath
	 *   An absolute path including the binding path
	 * @returns {SyncPromise}
	 *   A promise on the outcome of the cache's <code>read</code> call
	 *
	 * @private
	 */
	ODataListBinding.prototype.fetchAbsoluteValue = function (sPath) {
		var iIndex, iPos, sResolvedPath;

		if (this.oCache) {
			sResolvedPath = this.oModel.resolve(this.sPath, this.oContext) + "/";
			if (sPath.lastIndexOf(sResolvedPath) === 0) {
				sPath = sPath.slice(sResolvedPath.length);
				iIndex = parseInt(sPath, 10); // parseInt ignores any path following the number
				iPos = sPath.indexOf("/");
				sPath = iPos > 0 ? sPath.slice(iPos + 1) : "";
				return this.fetchValue(sPath, undefined, iIndex);
			}
		}
		if (this.oContext && this.oContext.fetchAbsoluteValue) {
			return this.oContext.fetchAbsoluteValue(sPath);
		}
		return _SyncPromise.resolve();
	};

	/**
	 * Requests a $filter query option value for the this binding; the value is computed from the
	 * given arrays of dynamic application and control filters and the given static filter.
	 *
	 * @param {sap.ui.model.Context} oContext
	 *   The context instance to be used; it is given as a parameter and this.oContext is unused
	 *   because setContext calls this method (indirectly) before calling the superclass to ensure
	 *   that the cache proxy is already created when the events are fired.
	 * @param {sap.ui.model.Filter[]} aApplicationFilters
	 *   The application filters
	 * @param {sap.ui.model.Filter[]} aControlFilters
	 *   The control filters
	 * @param {string} sStaticFilter
	 *   The static filter value
	 * @returns {_SyncPromise} A promise which resolves with the $filter value or "" if the
	 *   filter arrays are empty and the static filter parameter is not given. It rejects with
	 *   an error if a filter has an unknown operator or an invalid path.
	 *
	 * @private
	 */
	ODataListBinding.prototype.fetchFilter = function (oContext, aApplicationFilters,
			aControlFilters, sStaticFilter) {
		var aNonEmptyFilters = [],
			that = this;

		/**
		 * Concatenates the given $filter values using the given separator; the resulting
		 * value is enclosed in parentheses if more than one filter value is given.
		 *
		 * @param {string[]} aFilterValues The filter values
		 * @param {string} sSeparator The separator
		 * @returns {string} The combined filter value
		 */
		function combineFilterValues(aFilterValues, sSeparator) {
			var sFilterValue = aFilterValues.join(sSeparator);

			return aFilterValues.length > 1 ? "(" + sFilterValue + ")" : sFilterValue;
		}

		/**
		 * Returns the $filter value for the given single filter using the given Edm type to
		 * format the filter's operand(s).
		 *
		 * @param {sap.ui.model.Filter} oFilter The filter
		 * @param {string} sEdmType The Edm type
		 * @returns {string} The $filter value
		 */
		function getSingleFilterValue(oFilter, sEdmType) {
			var sFilter,
				sValue = _Helper.formatLiteral(oFilter.oValue1, sEdmType),
				sFilterPath = decodeURIComponent(oFilter.sPath);

			switch (oFilter.sOperator) {
				case FilterOperator.BT :
					sFilter = sFilterPath + " ge " + sValue + " and "
						+ sFilterPath + " le "
						+ _Helper.formatLiteral(oFilter.oValue2, sEdmType);
					break;
				case FilterOperator.EQ :
				case FilterOperator.GE :
				case FilterOperator.GT :
				case FilterOperator.LE :
				case FilterOperator.LT :
				case FilterOperator.NE :
					sFilter = sFilterPath + " " + oFilter.sOperator.toLowerCase() + " "
						+ sValue;
					break;
				case FilterOperator.Contains :
				case FilterOperator.EndsWith :
				case FilterOperator.StartsWith :
					sFilter = oFilter.sOperator.toLowerCase() + "(" + sFilterPath + ","
						+ sValue + ")";
					break;
				default :
					throw new Error("Unsupported operator: " + oFilter.sOperator);
			}
			return sFilter;
		}

		/**
		 * Requests the $filter value for an array of filters; filters with the same path are
		 * grouped with a logical 'or'.
		 *
		 * @param {sap.ui.model.Filter[]} aFilters The non-empty array of filters
		 * @param {boolean} [bAnd] Whether the filters are combined with 'and'; combined with
		 *   'or' if not given
		 * @returns {_SyncPromise} A promise which resolves with the $filter value
		 */
		function fetchArrayFilter(aFilters, bAnd) {
			var aFilterPromises = [],
				mFiltersByPath = {};

			aFilters.forEach(function (oFilter) {
				mFiltersByPath[oFilter.sPath] = mFiltersByPath[oFilter.sPath] || [];
				mFiltersByPath[oFilter.sPath].push(oFilter);
			});
			aFilters.forEach(function (oFilter) {
				var aFiltersForPath;

				if (oFilter.aFilters) { // array filter
					aFilterPromises.push(fetchArrayFilter(oFilter.aFilters, oFilter.bAnd)
						.then(function (sArrayFilter) {
							return "(" + sArrayFilter + ")";
						})
					);
					return;
				}
				// single filter
				aFiltersForPath = mFiltersByPath[oFilter.sPath];
				if (!aFiltersForPath) { // filter group for path of oFilter already processed
					return;
				}
				delete mFiltersByPath[oFilter.sPath];
				aFilterPromises.push(fetchGroupFilter(aFiltersForPath));
			});

			return _SyncPromise.all(aFilterPromises).then(function (aFilterValues) {
				return aFilterValues.join(bAnd ? " and " : " or ");
			});
		}

		/**
		 * Requests the $filter value for the given group of filters which all have the same
		 * path and thus refer to the same EDM type; the resulting filter value is
		 * the $filter values for the single filters in the group combined with a logical 'or'.
		 *
		 * @param {sap.ui.model.Filter[]} aGroupFilters The non-empty array of filters
		 * @returns {_SyncPromise} A promise which resolves with the $filter value or rejects
		 *   with an error if the filter value uses an unknown operator
		 */
		function fetchGroupFilter(aGroupFilters) {
			var oMetaModel = that.oModel.oMetaModel,
				oMetaContext = oMetaModel.getMetaContext(
					that.oModel.resolve(that.sPath, oContext)),
				oPropertyPromise = oMetaModel.fetchObject(aGroupFilters[0].sPath,
					oMetaContext);

			return oPropertyPromise.then(function (oPropertyMetadata) {
				var aGroupFilterValues;

				if (!oPropertyMetadata) {
					throw new Error("Type cannot be determined, no metadata for path: "
						+ oMetaContext.getPath());
				}

				aGroupFilterValues = aGroupFilters.map(function (oGroupFilter) {
						return getSingleFilterValue(oGroupFilter, oPropertyMetadata.$Type);
					});

				return combineFilterValues(aGroupFilterValues, " or ");
			});
		}

		return _SyncPromise.all([
			fetchArrayFilter(aApplicationFilters, /*bAnd*/true),
			fetchArrayFilter(aControlFilters, /*bAnd*/true)
		]).then(function (aFilterValues) {
			if (aFilterValues[0]) { aNonEmptyFilters.push(aFilterValues[0]); }
			if (aFilterValues[1]) { aNonEmptyFilters.push(aFilterValues[1]); }
			if (sStaticFilter) { aNonEmptyFilters.push(sStaticFilter); }

			return combineFilterValues(aNonEmptyFilters, ") and (");
		});
	};

	/**
	 * Requests the value for the given path and index; the value is requested from this binding's
	 * cache or from its context in case it has no cache.
	 *
	 * @param {string} [sPath]
	 *   Some relative path
	 * @param {sap.ui.model.odata.v4.ODataPropertyBinding} [oListener]
	 *   A property binding which registers itself as listener at the cache
	 * @param {number} iIndex
	 *   Index corresponding to some current context of this binding
	 * @returns {SyncPromise}
	 *   A promise on the outcome of the cache's <code>read</code> call
	 *
	 * @private
	 */
	ODataListBinding.prototype.fetchValue = function (sPath, oListener, iIndex) {
		if (this.oCache) {
			return this.oCache.read(iIndex, /*iLength*/1, undefined, sPath, undefined, oListener);
		}
		if (this.oContext) {
			return this.oContext.fetchValue(_Helper.buildPath(this.sPath, iIndex, sPath),
				oListener);
		}
		return _SyncPromise.resolve();
	};

	/**
	 * Filters the list with the given filters.
	 *
	 * If there are pending changes an error is thrown. Use {@link #hasPendingChanges} to check if
	 * there are pending changes. If there are changes, call
	 * {@link sap.ui.model.odata.v4.ODataModel#submitBatch} to submit the changes or
	 * {@link sap.ui.model.odata.v4.ODataModel#resetChanges} to reset the changes before calling
	 * {@link #filter}.
	 *
	 * @param {sap.ui.model.Filter|sap.ui.model.Filter[]} [vFilters]
	 *   The dynamic filters to be used; replaces the dynamic filters given in
	 *   {@link sap.ui.model.odata.v4.ODataModel#bindList}.
	 *   The filter executed on the list is created from the following parts, which are combined
	 *   with a logical 'and':
	 *   <ul>
	 *   <li> Dynamic filters of type {@link sap.ui.model.FilterType.Application}
	 *   <li> Dynamic filters of type {@link sap.ui.model.FilterType.Control}
	 *   <li> The static filters, as defined in the '$filter' binding parameter
	 *   </ul>
	 *
	 * @param {sap.ui.model.FilterType} [sFilterType=sap.ui.model.FilterType.Application]
	 *   The filter type to be used
	 * @returns {sap.ui.model.odata.v4.ODataListBinding}
	 *   <code>this</code> to facilitate method chaining
	 * @throws {Error}
	 *   If there are pending changes or if an unsupported operation mode is used (see
	 *   {@link sap.ui.model.odata.v4.ODataModel#bindList})
	 *
	 * @public
	 * @see sap.ui.model.ListBinding#filter
	 * @since 1.39.0
	 */
	ODataListBinding.prototype.filter = function (vFilters, sFilterType) {
		if (this.sOperationMode !== OperationMode.Server) {
			throw new Error("Operation mode has to be sap.ui.model.odata.OperationMode.Server");
		}
		if (this.hasPendingChanges()) {
			throw new Error("Cannot filter due to pending changes");
		}

		if (sFilterType === FilterType.Control) {
			this.aFilters = _Helper.toArray(vFilters);
		} else {
			this.aApplicationFilters = _Helper.toArray(vFilters);
		}
		this.mCacheByContext = undefined;
		this.oCache = this.makeCache(this.oContext);
		this.reset(ChangeReason.Filter);

		return this;
	};

	 /**
	 * Returns already created binding contexts for all entities in this list binding for the range
	 * determined by the given start index <code>iStart</code> and <code>iLength</code>.
	 * If at least one of the entities in the given range has not yet been loaded, fires a
	 * {@link #event:change} event on this list binding once these entities have been loaded
	 * <b>asynchronously</b>. A further call to this method in the 'change' event handler with the
	 * same index range then yields the updated array of contexts.
	 *
	 * @param {number} [iStart=0]
	 *   The index where to start the retrieval of contexts
	 * @param {number} [iLength]
	 *   The number of contexts to retrieve beginning from the start index; defaults to the model's
	 *   size limit, see {@link sap.ui.model.Model#setSizeLimit}
	 * @param {number} [iMaximumPrefetchSize=0]
	 *   The maximum number of contexts to read before and after the given range; with this,
	 *   controls can prefetch data that is likely to be needed soon, e.g. when scrolling down in a
	 *   table. Negative values will be treated as 0.
	 *   Supported since 1.39.0
	 * @returns {sap.ui.model.odata.v4.Context[]}
	 *   The array of already created contexts with the first entry containing the context for
	 *   <code>iStart</code>
	 * @throws {Error}
	 *   If extended change detection is enabled and <code>iMaximumPrefetchSize</code> is set or
	 *   <code>iStart</code> is not 0
	 *
	 * @protected
	 * @see sap.ui.model.ListBinding#getContexts
	 * @since 1.37.0
	 */
	ODataListBinding.prototype.getContexts = function (iStart, iLength, iMaximumPrefetchSize) {
		// iStart: in view coordinates (always starting with 0)
		var sChangeReason,
			oContext = this.oContext,
			aContexts,
			bDataRequested = false,
			bFireChange = false,
			sGroupId,
			oPromise,
			oRange,
			bRefreshEvent = !!this.sChangeReason,
			iStartInModel, // in model coordinates
			that = this;

		jQuery.sap.log.debug(this + "#getContexts(" + iStart + ", " + iLength + ", "
				+ iMaximumPrefetchSize + ")",
			undefined, sClassName);

		if (iStart !== 0 && this.bUseExtendedChangeDetection) {
			throw new Error("Unsupported operation: v4.ODataListBinding#getContexts,"
				+ " first parameter must be 0 if extended change detection is enabled, but is "
				+ iStart);
		}

		if (iMaximumPrefetchSize !== undefined && this.bUseExtendedChangeDetection) {
			throw new Error("Unsupported operation: v4.ODataListBinding#getContexts,"
				+ " third parameter must not be set if extended change detection is enabled");
		}

		if (this.bRelative && !oContext) { // unresolved relative binding
			return [];
		}

		sChangeReason = this.sChangeReason || ChangeReason.Change;
		this.sChangeReason = undefined;

		iStart = iStart || 0;
		iLength = iLength || this.oModel.iSizeLimit;
		if (!iMaximumPrefetchSize || iMaximumPrefetchSize < 0) {
			iMaximumPrefetchSize = 0;
		}
		iStartInModel = this.aContexts[-1] ? iStart - 1 : iStart;

		if (!this.bUseExtendedChangeDetection || !this.oDiff) {
			oRange = this.getReadRange(iStartInModel, iLength, iMaximumPrefetchSize);
			if (this.oCache) {
				sGroupId = this.sRefreshGroupId || this.getGroupId();
				this.sRefreshGroupId = undefined;
				oPromise = this.oCache.read(oRange.start, oRange.length, sGroupId, undefined,
					function () {
						bDataRequested = true;
						that.fireDataRequested();
				});
			} else {
				oPromise = oContext.fetchValue(this.sPath).then(function (aResult) {
					// aResult may be undefined e.g. in case of a missing $expand in parent binding
					return aResult ? aResult.slice(oRange.start, oRange.start + oRange.length) : [];
				});
			}
			if (oPromise.isFulfilled() && bRefreshEvent) {
				// make sure "refresh" is followed by async "change"
				oPromise = Promise.resolve(oPromise);
			}
			oPromise.then(function (vResult) {
				var bContextsCreated,
					aResult;

				// ensure that the result is still relevant
				if (!that.bRelative || that.oContext === oContext) {
					aResult = vResult && (Array.isArray(vResult) ? vResult : vResult.value);
					bContextsCreated = that.createContexts(oRange, aResult.length);
					if (that.bUseExtendedChangeDetection) {
						that.oDiff = {
							// aResult[0] corresponds to oRange.start = iStartInModel for E.C.D.
							aDiff: that.getDiff(aResult, iStartInModel),
							iLength : iLength
						};
					}
					if (bFireChange && bContextsCreated) {
						that._fireChange({reason: sChangeReason});
					}
				}
				if (bDataRequested) {
					that.fireDataReceived();
				}
			}, function (oError) {
				// cache shares promises for concurrent read
				if (bDataRequested) {
					that.fireDataReceived(oError.canceled ? undefined : {error : oError});
				}
				throw oError;
			})["catch"](function (oError) {
				that.oModel.reportError("Failed to get contexts for "
						+ that.oModel.sServiceUrl
						+ that.oModel.resolve(that.sPath, that.oContext).slice(1)
						+ " with start index " + iStart + " and length " + iLength,
					sClassName, oError);
			});
			// in case of asynchronous processing ensure to fire a change event
			bFireChange = true;
		}
		this.iCurrentBegin = iStartInModel;
		this.iCurrentEnd = iStartInModel + iLength;
		if (iStartInModel === -1) {
			aContexts = this.aContexts.slice(0, iStartInModel + iLength);
			aContexts.unshift(this.aContexts[-1]);
		} else {
			aContexts = this.aContexts.slice(iStartInModel, iStartInModel + iLength);
		}
		if (this.bUseExtendedChangeDetection) {
			if (this.oDiff && iLength !== this.oDiff.iLength) {
				throw new Error("Extended change detection protocol violation: Expected "
					+ "getContexts(0," + this.oDiff.iLength + "), but got getContexts(0,"
					+ iLength + ")");
			}
			aContexts.dataRequested = !this.oDiff;
			aContexts.diff = this.oDiff ? this.oDiff.aDiff : [];
		}
		this.oDiff = undefined;
		return aContexts;
	};

	/**
	 * Returns the contexts that were requested by a control last time. Does not trigger a data
	 * request. In the time between the {@link #event:dataRequested} event and the
	 * {@link #event:dataReceived} event, the resulting array contains <code>undefined</code> at
	 * those indexes where the data is not yet available.
	 *
	 * @returns {sap.ui.model.odata.v4.Context[]}
	 *   The contexts
	 *
	 * @public
	 * @see sap.ui.model.ListBinding#getCurrentContexts
	 * @since 1.39.0
	 */
	// @override
	ODataListBinding.prototype.getCurrentContexts = function () {
		var aContexts,
			iLength = Math.min(this.iCurrentEnd, this.iMaxLength) - this.iCurrentBegin;

		if (this.iCurrentBegin === -1) {
			aContexts = this.aContexts.slice(0, this.iCurrentBegin + iLength);
			aContexts.unshift(this.aContexts[-1]);
		} else {
			aContexts = this.aContexts.slice(this.iCurrentBegin, this.iCurrentBegin + iLength);
		}


		while (aContexts.length < iLength) {
			aContexts.push(undefined);
		}
		return aContexts;
	};

	/**
	 * Computes the "diff" needed for extended change detection.
	 *
	 * @param {object[]} aResult
	 *   The array of OData entities read in the last request
	 * @param {number} iStartInModel
	 *   The start index in model coordinates of the range for which the OData entities have been
	 *   read
	 * @returns {object}
	 *   The array of differences which is
	 *   <ul>
	 *   <li>the comparison of aResult with the data retrieved in the previous request, in case of
	 *   <code>this.bDetectUpdates === true</code></li>
	 *   <li>the comparison of current context paths with the context paths of the previous request,
	 *   in case of <code>this.bDetectUpdates === false</code></li>
	 *   </ul>
	 *
	 * @private
	 */
	ODataListBinding.prototype.getDiff = function (aResult, iStartInModel) {
		var aDiff,
			aNewData,
			that = this;

		aNewData = aResult.map(function (oEntity, i) {
			return that.bDetectUpdates
				? JSON.stringify(oEntity)
				: that.aContexts[iStartInModel + i].getPath();
		});
		aDiff = jQuery.sap.arraySymbolDiff(this.aPreviousData, aNewData);
		this.aPreviousData = aNewData;
		return aDiff;
	};

	/**
	 * Method not supported
	 *
	 * @throws {Error}
	 *
	 * @public
	 * @see sap.ui.model.ListBinding#getDistinctValues
	 * @since 1.37.0
	 */
	// @override
	ODataListBinding.prototype.getDistinctValues = function () {
		throw new Error("Unsupported operation: v4.ODataListBinding#getDistinctValues");
	};

	/**
	 * Returns the number of entries in the list. As long as the client does not know the size on
	 * the server an estimated length is returned.
	 *
	 * @returns {number}
	 *   The number of entries in the list
	 *
	 * @public
	 * @see sap.ui.model.ListBinding#getLength
	 * @since 1.37.0
	 */
	 // @override
	ODataListBinding.prototype.getLength = function () {
		var iLength = this.aContexts.length;

		if (this.aContexts[-1]) {
			iLength += 1;
		}
		if (!this.bLengthFinal) {
			iLength += 10;
		}
		return iLength;
	};

	/**
	 * Calculates the index range to be read for the given start, length and threshold.
	 * Checks if <code>aContexts</code> entries are available for the given index range plus
	 * half the threshold left and right to it.
	 *
	 * @param {number} iStart
	 *   The start index for the data request in model coordinates (starting with 0 or -1)
	 * @param {number} iLength
	 *   The number of requested entries
	 * @param {number} iMaximumPrefetchSize
	 *   The number of entries to prefetch before and after the given range
	 * @returns {object}
	 *   Returns an object with a member <code>start</code> for the start index for the next
	 *   read and <code>length</code> for the number of entries to be read. The output is in
	 *   model coordinates (starting with 0 or -1).
	 */
	ODataListBinding.prototype.getReadRange = function (iStart, iLength, iMaximumPrefetchSize) {
		var aContexts = this.aContexts;

		// Checks whether aContexts contains at least one <code>undefined</code> entry within the
		// given start (inclusive) and end (exclusive).
		function isDataMissing(iStart, iEnd) {
			var i;
			for (i = iStart; i < iEnd; i += 1) {
				if (aContexts[i] === undefined) {
					return true;
				}
			}
			return false;
		}

		if (isDataMissing(iStart + iLength, iStart + iLength + iMaximumPrefetchSize / 2)) {
			iLength += iMaximumPrefetchSize;
		}
		if (isDataMissing(Math.max(iStart - iMaximumPrefetchSize / 2, 0), iStart)) {
			iLength += iMaximumPrefetchSize;
			iStart -= iMaximumPrefetchSize;
			if (iStart < 0) {
				iLength += iStart;
				iStart = 0;
			}
		}
		return {length : iLength, start : iStart};
	};

	/**
	 * Returns <code>true</code> if the length has been determined by the data returned from
	 * server. If the length is a client side estimation <code>false</code> is returned.
	 *
	 * @returns {boolean}
	 *   If <code>true</true> the length is determined by server side data
	 *
	 * @public
	 * @see sap.ui.model.ListBinding#isLengthFinal
	 * @since 1.37.0
	 */
	// @override
	ODataListBinding.prototype.isLengthFinal = function () {
		// some controls use .bLengthFinal on list binding instead of calling isLengthFinal
		return this.bLengthFinal;
	};

	/**
	 * Creates a cache for the binding using the given context.
	 * Ensures that sort and filter parameters are added to the query string.
	 *
	 * The context is given as a parameter and this.oContext is unused because setContext calls
	 * this method before calling the superclass to ensure that the cache is already created when
	 * the events are fired.
	 *
	 * @param {sap.ui.model.Context} [oContext]
	 *   The context instance to be used, may be omitted for absolute bindings
	 * @returns {object}
	 *   The created cache, cache proxy or undefined if none is required (allows for easier
	 *   testing)
	 *
	 * @private
	 */
	ODataListBinding.prototype.makeCache = function (oContext) {
		var vCanonicalPath, oFilterPromise, mQueryOptions,
			that = this;

		function createCache(sPath, sFilter) {
			var sOrderby = that.buildOrderbyOption(that.aSorters,
					mQueryOptions && mQueryOptions.$orderby);

			return _Cache.create(that.oModel.oRequestor,
				_Helper.buildPath(sPath, that.sPath).slice(1),
				that.mergeQueryOptions(mQueryOptions, sOrderby, sFilter));
		}

		if (this.bRelative) {
			if (!oContext
					|| oContext.fetchCanonicalPath
					&& !Object.keys(this.mParameters).length
					&& !this.aSorters.length
					&& !this.aFilters.length
					&& !this.aApplicationFilters.length) {
				return undefined; // no need for an own cache
			}
		} else {
			oContext = undefined; // must be ignored for absolute bindings
		}
		mQueryOptions = this.getQueryOptions("", oContext);
		vCanonicalPath = oContext && (oContext.fetchCanonicalPath
			? oContext.fetchCanonicalPath() : oContext.getPath());
		oFilterPromise = this.fetchFilter(oContext, this.aApplicationFilters, this.aFilters,
			mQueryOptions && mQueryOptions.$filter);
		return this.createCache(createCache, vCanonicalPath, oFilterPromise);
	};

	/**
	 * Merges the given values for "$orderby" and "$filter" into the given map of query options.
	 * Ensures that the original map is left unchanged, but creates a copy only if necessary.
	 *
	 * @param {object} [mQueryOptions]
	 *   The map of query options
	 * @param {string} [sOrderby]
	 *   The new value for the query option "$orderby"
	 * @param {string} [sFilter]
	 *   The new value for the query option "$filter"
	 * @returns {object}
	 *   The merged map of query options
	 */
	ODataListBinding.prototype.mergeQueryOptions = function (mQueryOptions, sOrderby, sFilter) {
		var mResult;

		function set(sProperty, sValue) {
			if (sValue && (!mQueryOptions || mQueryOptions[sProperty] !== sValue)) {
				if (!mResult) {
					mResult = mQueryOptions ? JSON.parse(JSON.stringify(mQueryOptions)) : {};
				}
				mResult[sProperty] = sValue;
			}
		}

		set("$orderby", sOrderby);
		set("$filter", sFilter);
		return mResult || mQueryOptions;
	};

	/**
	 * @override sap.ui.model.odata.v4.ODataBinding#refreshInternal
	 * @inheritdoc
	 */
	ODataListBinding.prototype.refreshInternal = function (sGroupId) {
		this.sRefreshGroupId = sGroupId;
		if (this.oCache) {
			this.oCache = this.makeCache(this.oContext);
			this.mCacheByContext = undefined;
		}
		this.reset(ChangeReason.Refresh);
		this.oModel.getDependentBindings(this).forEach(function (oDependentBinding) {
			if (!oDependentBinding.getContext().created()) {
				oDependentBinding.refreshInternal(sGroupId);
			}
		});
	};

	/**
	 * Resets the binding's contexts array and its members related to current contexts and length
	 * calculation.
	 *
	 * @param {sap.ui.model.ChangeReason} [sChangeReason]
	 *   A change reason; if given, a refresh event with this reason is fired and the next
	 *   getContexts() fires a change event with this reason.
	 *
	 * @private
	 */
	ODataListBinding.prototype.reset = function (sChangeReason) {
		var that = this;

		if (this.aContexts) {
			this.aContexts.forEach(function (oContext) {
				that.mPreviousContextsByPath[oContext.getPath()] = oContext;
			});
		}
		this.aContexts = [];
		// the range for getCurrentContexts
		this.iCurrentBegin = this.iCurrentEnd = 0;
		// upper boundary for server-side list length (based on observations so far)
		this.iMaxLength = Infinity;
		// this.bLengthFinal = this.aContexts.length === this.iMaxLength
		this.bLengthFinal = false;
		if (sChangeReason) {
			this.sChangeReason = sChangeReason;
			this._fireRefresh({reason : sChangeReason});
		}
	};

	/**
	 * Sets the context and resets the cached contexts of the list items.
	 *
	 * @param {sap.ui.model.Context} oContext
	 *   The context object
	 *
	 * @private
	 * @see sap.ui.model.Binding#setContext
	 */
	// @override
	ODataListBinding.prototype.setContext = function (oContext) {
		if (this.oContext !== oContext) {
			if (this.bRelative) {
				this.reset();
				this.oCache = this.makeCache(oContext);
				// call Binding#setContext because of data state etc.; fires "change"
				Binding.prototype.setContext.call(this, oContext);
			} else {
				// remember context even if no "change" fired
				this.oContext = oContext;
			}
		}
	};

	/**
	 * Sets this binding's parameters to the given map of parameters.
	 *
	 * @param {object} [mParameters]
	 *   Map of binding parameters, {@link sap.ui.model.odata.v4.ODataModel#constructor}
	 * @param {sap.ui.model.ChangeReason} [sChangeReason]
	 *   A change reason for {@link #reset}
	 *
	 * @private
	 */
	ODataListBinding.prototype.setParameters = function (mParameters, sChangeReason) {
		var oBindingParameters = this.oModel.buildBindingParameters(mParameters,
				["$$groupId", "$$operationMode", "$$updateGroupId"]);

		this.sOperationMode = oBindingParameters.$$operationMode || this.oModel.sOperationMode;
		// Note: $$operationMode is validated before, this.oModel.sOperationMode also
		// Just check for the case that no mode was specified, but sort/filter takes place
		if (!this.sOperationMode && (this.aSorters.length || this.aApplicationFilters.length)) {
			throw new Error("Unsupported operation mode: " + this.sOperationMode);
		}

		this.sGroupId = oBindingParameters.$$groupId;
		this.sUpdateGroupId = oBindingParameters.$$updateGroupId;
		this.mParameters = mParameters;
		this.mQueryOptions = this.oModel.buildQueryOptions(this.oModel.mUriParameters,
			mParameters, true);
		this.reset(sChangeReason);
	};

	/**
	 * Sort the entries represented by this list binding according to the given sorters.
	 * The sorters are stored at this list binding and they are used for each following data
	 * request.
	 *
	 * If there are pending changes an error is thrown. Use {@link #hasPendingChanges} to check if
	 * there are pending changes. If there are changes, call
	 * {@link sap.ui.model.odata.v4.ODataModel#submitBatch} to submit the changes or
	 * {@link sap.ui.model.odata.v4.ODataModel#resetChanges} to reset the changes before calling
	 * {@link #sort}.
	 *
	 * @param {sap.ui.model.Sorter | sap.ui.model.Sorter[]} [vSorters]
	 *   The dynamic sorters to be used; they replace the dynamic sorters given in
	 *   {@link sap.ui.model.odata.v4.ODataModel#bindList}.
	 *   Static sorters, as defined in the '$orderby' binding parameter, are always executed after
	 *   the dynamic sorters.
	 * @returns {sap.ui.model.odata.v4.ODataListBinding}
	 *   <code>this</code> to facilitate method chaining
	 * @throws {Error}
	 *   If there are pending changes or if an unsupported operation mode is used (see
	 *   {@link sap.ui.model.odata.v4.ODataModel#bindList}).
	 *
	 * @public
	 * @see sap.ui.model.ListBinding#sort
	 * @since 1.39.0
	 */
	ODataListBinding.prototype.sort = function (vSorters) {
		if (this.sOperationMode !== OperationMode.Server) {
			throw new Error("Operation mode has to be sap.ui.model.odata.OperationMode.Server");
		}

		if (this.hasPendingChanges()) {
			throw new Error("Cannot sort due to pending changes");
		}

		this.aSorters = _Helper.toArray(vSorters);
		this.mCacheByContext = undefined;
		this.oCache = this.makeCache(this.oContext);
		this.reset(ChangeReason.Sort);
		return this;
	};

	/**
	 * Returns a string representation of this object including the binding path. If the binding is
	 * relative, the parent path is also given, separated by a '|'.
	 *
	 * @return {string} A string description of this binding
	 * @public
	 * @since 1.37.0
	 */
	ODataListBinding.prototype.toString = function () {
		return sClassName + ": " + (this.bRelative ? this.oContext + "|" : "") + this.sPath;
	};

	return ODataListBinding;
}, /* bExport= */ true);
